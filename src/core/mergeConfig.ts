import type { RequestConfig } from '../types'

/**
 * Merge default config and request config.
 */
export function mergeConfig(
  defaults: Partial<RequestConfig>,
  config: RequestConfig
): RequestConfig {
  return {
    ...defaults,
    ...config,
    headers: mergeHeaders(defaults.headers, config.headers)
  }
}

/**
 * Merge headers.
 */
function mergeHeaders(
  defaults?: HeadersInit,
  headers?: HeadersInit
): HeadersInit | undefined {
  if (!defaults && !headers) {
    return undefined
  }

  return {
    ...normalizeHeaders(defaults),
    ...normalizeHeaders(headers)
  }
}

/**
 * Normalize headers to plain object.
 */
function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {}
  }

  if (headers instanceof Headers) {
    const result: Record<string, string> = {}

    headers.forEach((value, key) => {
      result[key] = value
    })

    return result
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return headers as Record<string, string>
}
