import type { CacheOptions, HttpMethod, RequestConfig } from '../types'
import { isRequestError } from '../errors'
import type { PluginContext } from './Plugin'
import type { CacheEventType } from './cachePlugin'
import type { CacheEntry } from './cacheStores'
import {
  hasCacheControlDirective,
  resolveStaleIfErrorWindow,
  resolveStaleWhileRevalidateWindow
} from './cachePolicy'

type RecordCacheEvent = (type: CacheEventType) => void

export function isCacheableRequest(
  config: RequestConfig,
  methods: ReadonlySet<HttpMethod>,
  cache: CacheOptions
): boolean {
  return (
    methods.has(config.method ?? 'GET') &&
    (!hasRequestBody(config) || Boolean(cache.key)) &&
    (!config.parseJson || Boolean(cache.key)) &&
    (!config.querySerializer || Boolean(cache.key)) &&
    config.responseType !== 'stream' &&
    config.responseType !== 'sse' &&
    config.responseType !== 'ndjson' &&
    config.responseType !== 'bytes' &&
    config.responseType !== 'formData' &&
    config.fetchOptions?.mode !== 'no-cors' &&
    config.fetchOptions?.redirect !== 'manual'
  )
}

function hasRequestBody(config: RequestConfig): boolean {
  return config.body != null ||
    config.json !== undefined ||
    config.form != null ||
    config.formData != null
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
}

export function isSchemaValidationFailure(error: unknown): boolean {
  return isRequestError(error) && error.code === 'SCHEMA_ERROR'
}

export function canUseStaleIfError(
  record: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean,
  configuredStaleIfError?: number
): boolean {
  try {
    if (preserveRaw && !record.raw) {
      return false
    }

    if (hasConditionalRequestHeaders(config)) {
      return false
    }

    const window = resolveStaleIfErrorWindow(
      new Headers(record.headers),
      configuredStaleIfError
    )

    return window > 0 &&
      Number.isFinite(record.expiresAt) &&
      Date.now() < record.expiresAt + window
  } catch {
    return false
  }
}

export function canUseStaleWhileRevalidate(
  record: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean,
  configured?: number
): boolean {
  try {
    if (preserveRaw && !record.raw) {
      return false
    }

    const responseHeaders = new Headers(record.headers)

    if (
      hasConditionalRequestHeaders(config) ||
      hasCacheControlDirective(responseHeaders, 'no-cache') ||
      hasCacheControlDirective(responseHeaders, 'must-revalidate')
    ) {
      return false
    }

    const window = resolveStaleWhileRevalidateWindow(
      responseHeaders,
      configured
    )

    return window > 0 &&
      Number.isFinite(record.expiresAt) &&
      Date.now() < record.expiresAt + window
  } catch {
    return false
  }
}

export function startBackgroundRefresh(
  context: PluginContext,
  refreshes: Map<string, AbortController>,
  key: string,
  config: RequestConfig,
  preserveRaw: boolean,
  recordEvent: RecordCacheEvent
): void {
  if (refreshes.has(key)) {
    return
  }

  const controller = new AbortController()
  const refreshConfig: RequestConfig = {
    ...config,
    signal: controller.signal
  }

  refreshes.set(key, controller)
  recordEvent('background-refresh')

  void Promise.resolve()
    .then(() => context.dispatch(refreshConfig, {
      background: true,
      preserveRaw
    }))
    .then(
      () => recordEvent('background-refresh-success'),
      () => recordEvent('background-refresh-error')
    )
    .finally(() => {
      if (refreshes.get(key) === controller) {
        refreshes.delete(key)
      }
    })
}

export function abortBackgroundRefreshes(
  refreshes: Map<string, AbortController>
): void {
  for (const controller of refreshes.values()) {
    controller.abort('Cache background refresh stopped')
  }

  refreshes.clear()
}

export function isEligibleStaleIfError(error: unknown): boolean {
  return isRequestError(error) && (
    error.code === 'NETWORK_ERROR' ||
    error.code === 'TIMEOUT_ERROR' ||
    (
      error.code === 'HTTP_ERROR' &&
      error.status !== undefined &&
      error.status >= 500 &&
      error.status < 600
    )
  )
}

export function canRevalidateCacheEntry(
  record: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean
): boolean {
  try {
    if (preserveRaw && !record.raw) {
      return false
    }

    if (hasConditionalRequestHeaders(config)) {
      return false
    }

    return hasResponseValidator(new Headers(record.headers))
  } catch {
    return false
  }
}

export function prepareConditionalRevalidation(
  config: RequestConfig,
  record: CacheEntry
): boolean {
  const storedHeaders = new Headers(record.headers)
  const etag = storedHeaders.get('etag')
  const lastModified = storedHeaders.get('last-modified')

  if (!etag && !lastModified) {
    return false
  }

  const headers = new Headers(config.headers)

  if (etag) {
    headers.set('if-none-match', etag)
  }

  if (lastModified) {
    headers.set('if-modified-since', lastModified)
  }

  const validateStatus = config.validateStatus
  const throwHttpErrors = config.throwHttpErrors

  config.headers = headers
  config.throwHttpErrors = undefined
  config.validateStatus = status => {
    return status === 304 || (
      validateStatus
        ? validateStatus(status)
        : throwHttpErrors === false || (
          status >= 200 && status < 300
        )
    )
  }
  return true
}

function hasResponseValidator(headers: Headers): boolean {
  return headers.has('etag') || headers.has('last-modified')
}

function hasConditionalRequestHeaders(config: RequestConfig): boolean {
  const headers = new Headers(config.headers)

  return headers.has('if-none-match') ||
    headers.has('if-modified-since') ||
    headers.has('range')
}
