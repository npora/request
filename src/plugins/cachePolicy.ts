import type { NporaResponse, RequestConfig } from '../types'

export interface ResponseCachePolicy {
  persist: boolean
  ttl: number
}

export type RequestCachePolicy = 'default' | 'revalidate' | 'no-store'

const NO_CACHE_POLICY: ResponseCachePolicy = {
  persist: false,
  ttl: 0
}

export function resolveRequestCachePolicy(
  config: RequestConfig
): RequestCachePolicy {
  const headers = new Headers(config.headers)
  const cacheControl = headers.get('cache-control')
  let revalidate = false

  if (cacheControl) {
    for (const value of cacheControl.split(',')) {
      const directive = value.trim()
      const separator = directive.indexOf('=')
      const name = (
        separator === -1 ? directive : directive.slice(0, separator)
      ).trim().toLowerCase()

      if (name === 'no-store') return 'no-store'
      if (name === 'no-cache') {
        revalidate = true
        continue
      }
      if (name === 'max-age' && separator !== -1) {
        const match = /^(?:"(\d+)"|(\d+))$/.exec(
          directive.slice(separator + 1).trim()
        )
        if (match && Number(match[1] ?? match[2]) === 0) revalidate = true
      }
    }
  } else if (headers.get('pragma')?.split(',').some(
    value => value.trim().toLowerCase() === 'no-cache'
  )) {
    revalidate = true
  }

  return revalidate ? 'revalidate' : 'default'
}

export function resolveResponseCachePolicy(
  response: NporaResponse,
  configuredTtl: number,
  configuredStaleIfError?: number,
  configuredStaleWhileRevalidate?: number
): ResponseCachePolicy {
  const cacheControl = response.headers.get('cache-control')
  let maxAgeSeconds: number | undefined
  let requiresRevalidation = false

  if (cacheControl) {
    for (const value of cacheControl.split(',')) {
      const directive = value.trim()
      const separator = directive.indexOf('=')
      const name = (
        separator === -1 ? directive : directive.slice(0, separator)
      ).trim().toLowerCase()

      if (name === 'no-store') return NO_CACHE_POLICY
      if (name === 'no-cache') {
        requiresRevalidation = true
        continue
      }
      if (name !== 'max-age') continue
      if (maxAgeSeconds !== undefined) return NO_CACHE_POLICY

      const match = /^(?:"(\d+)"|(\d+))$/.exec(
        directive.slice(separator + 1).trim()
      )
      if (!match) return NO_CACHE_POLICY
      maxAgeSeconds = Number(match[1] ?? match[2])
    }
  }

  if (response.headers.get('vary')?.split(',').some(name => {
    const normalized = name.trim().toLowerCase()
    return normalized === '*' || isRequestCacheControlHeader(normalized)
  })) return NO_CACHE_POLICY

  if (
    configuredTtl <= 0 ||
    (maxAgeSeconds !== undefined && !Number.isSafeInteger(maxAgeSeconds))
  ) return NO_CACHE_POLICY

  const ttl = requiresRevalidation
    ? 0
    : maxAgeSeconds === undefined
      ? configuredTtl
      : Math.min(configuredTtl, Math.max(
          0,
          (maxAgeSeconds - parseAge(response.headers.get('age'))) * 1000
        ))

  return {
    ttl,
    persist: ttl > 0 ||
      hasResponseValidator(response.headers) ||
      resolveStaleIfErrorWindow(
        response.headers,
        configuredStaleIfError
      ) > 0 ||
      (!requiresRevalidation && resolveStaleWhileRevalidateWindow(
        response.headers,
        configuredStaleWhileRevalidate
      ) > 0)
  }
}

export function resolveStaleIfErrorWindow(
  headers: Headers,
  configured?: number
): number {
  return resolveWindow(headers, configured, 'stale-if-error')
}

export function resolveStaleWhileRevalidateWindow(
  headers: Headers,
  configured?: number
): number {
  return resolveWindow(headers, configured, 'stale-while-revalidate')
}

export function hasCacheControlDirective(
  headers: Headers,
  expectedName: string
): boolean {
  return headers.get('cache-control')?.split(',').some(value => {
    const separator = value.indexOf('=')
    const name = separator === -1 ? value : value.slice(0, separator)
    return name.trim().toLowerCase() === expectedName
  }) ?? false
}

function resolveWindow(
  headers: Headers,
  configured: number | undefined,
  directive: string
): number {
  const server = parseCacheDeltaSeconds(
    headers.get('cache-control'),
    directive
  )
  if (configured === undefined) return server ?? 0
  return server === undefined ? configured : Math.min(configured, server)
}

function parseCacheDeltaSeconds(
  value: string | null,
  expectedName: string
): number | undefined {
  let seconds: number | undefined
  if (!value) return undefined

  for (const item of value.split(',')) {
    const directive = item.trim()
    const separator = directive.indexOf('=')
    if (
      separator === -1 ||
      directive.slice(0, separator).trim().toLowerCase() !== expectedName
    ) continue
    if (seconds !== undefined) return undefined

    const match = /^(?:"(\d+)"|(\d+))$/.exec(
      directive.slice(separator + 1).trim()
    )
    if (!match) return undefined
    seconds = Number(match[1] ?? match[2])
  }

  if (seconds === undefined || !Number.isSafeInteger(seconds)) return undefined
  const milliseconds = seconds * 1000
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined
}

function parseAge(value: string | null): number {
  if (!value || !/^\d+$/.test(value.trim())) return 0
  const age = Number(value)
  return Number.isSafeInteger(age) ? age : 0
}

function hasResponseValidator(headers: Headers): boolean {
  return headers.has('etag') || headers.has('last-modified')
}

function isRequestCacheControlHeader(name: string): boolean {
  return name === 'cache-control' || name === 'pragma'
}
