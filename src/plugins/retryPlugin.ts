import { RequestError } from '../errors'
import type {
  HttpMethod,
  RequestConfig,
  RetryOptions
} from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

const DEFAULT_RETRY_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD',
  'OPTIONS',
  'PUT',
  'DELETE'
]

interface NormalizedRetryOptions {
  retries: number

  methods: ReadonlySet<HttpMethod>

  delay: (
    attempt: number,
    error: unknown
  ) => number | Promise<number>

  respectRetryAfter: boolean

  maxDelay: number

  shouldRetry: (
    error: unknown,
    attempt: number
  ) => boolean | Promise<boolean>
}

export function retryPlugin(
  defaultOptions: RetryOptions = {}
): Plugin {
  return {
    name: 'retry',

    install(context) {
      context.hooks.onRetry(async (requestContext, attempt) => {
        if (!requestContext.error) {
          return undefined
        }

        const retryOptions = normalizeRetryOptions(
          resolveExtensionConfig(
            requestContext.config,
            'retry',
            requestContext.config.retry
          ),
          defaultOptions
        )

        if (attempt >= retryOptions.retries) {
          return undefined
        }

        if (
          !canRetryRequest(
            requestContext.config,
            retryOptions.methods
          )
        ) {
          return undefined
        }

        const shouldRetry = await retryOptions.shouldRetry(
          requestContext.error,
          attempt
        )

        if (!shouldRetry) {
          return undefined
        }

        const configuredDelay = await retryOptions.delay(
          attempt,
          requestContext.error
        )
        const retryAfter = retryOptions.respectRetryAfter
          ? parseRetryAfter(requestContext.error)
          : undefined

        return {
          retry: true,
          delay: normalizeRetryDelay(
            retryAfter ?? configuredDelay,
            retryOptions.maxDelay
          )
        }
      })
    }
  }
}

function normalizeRetryOptions(
  retry?: number | RetryOptions,
  defaults: RetryOptions = {}
): NormalizedRetryOptions {
  if (typeof retry === 'number') {
    return {
      retries: normalizeRetries(retry),
      methods: normalizeMethods(defaults.methods),
      delay: normalizeDelay(defaults.delay),
      respectRetryAfter:
        defaults.respectRetryAfter ?? true,
      maxDelay: normalizeMaxDelay(defaults.maxDelay),
      shouldRetry:
        defaults.shouldRetry ?? defaultShouldRetry
    }
  }

  return {
    retries: normalizeRetries(
      retry?.retries ?? defaults.retries ?? 0
    ),
    methods: normalizeMethods(
      retry?.methods ?? defaults.methods
    ),
    delay: normalizeDelay(
      retry?.delay ?? defaults.delay
    ),
    respectRetryAfter:
      retry?.respectRetryAfter ??
      defaults.respectRetryAfter ??
      true,
    maxDelay: normalizeMaxDelay(
      retry?.maxDelay ?? defaults.maxDelay
    ),
    shouldRetry:
      retry?.shouldRetry ??
      defaults.shouldRetry ??
      defaultShouldRetry
  }
}

function normalizeMethods(
  methods?: readonly HttpMethod[]
): ReadonlySet<HttpMethod> {
  return new Set(methods ?? DEFAULT_RETRY_METHODS)
}

function normalizeMaxDelay(maxDelay?: number): number {
  if (maxDelay === undefined) {
    return 60000
  }

  if (!Number.isFinite(maxDelay)) {
    return maxDelay > 0 ? Number.MAX_SAFE_INTEGER : 0
  }

  return Math.max(0, maxDelay)
}

function normalizeRetries(retries: number): number {
  if (!Number.isFinite(retries)) {
    return 0
  }

  return Math.max(0, Math.floor(retries))
}

function normalizeDelay(
  delay?: RetryOptions['delay']
): NormalizedRetryOptions['delay'] {
  if (typeof delay === 'number') {
    const normalizedDelay = Math.max(0, delay)

    return () => normalizedDelay
  }

  return delay ?? defaultRetryDelay
}

function defaultRetryDelay(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 1000)
}

function normalizeRetryDelay(delay: number, maxDelay: number): number {
  if (!Number.isFinite(delay)) {
    return delay > 0 ? maxDelay : 0
  }

  return Math.min(Math.max(0, delay), maxDelay)
}

function canRetryRequest(
  config: RequestConfig,
  methods: ReadonlySet<HttpMethod>
): boolean {
  const method = config.method ?? 'GET'

  if (!methods.has(method)) {
    return false
  }

  return !isReadableStream(config.body)
}

function isReadableStream(value: unknown): boolean {
  return (
    typeof ReadableStream !== 'undefined' &&
    value instanceof ReadableStream
  )
}

function parseRetryAfter(error: unknown): number | undefined {
  if (!(error instanceof RequestError)) {
    return undefined
  }

  const value = error.response?.headers.get('retry-after')

  if (!value) {
    return undefined
  }

  const seconds = Number(value)

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const date = Date.parse(value)

  if (Number.isNaN(date)) {
    return undefined
  }

  return Math.max(0, date - Date.now())
}

function defaultShouldRetry(error: unknown): boolean {
  if (!(error instanceof RequestError)) {
    return false
  }

  if (error.code === 'NETWORK_ERROR') {
    return true
  }

  if (error.status === undefined) {
    return false
  }

  return (
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  )
}
