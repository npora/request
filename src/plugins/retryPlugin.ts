import { RequestError } from '../errors'
import type {
  HttpMethod,
  RequestConfig,
  RetryEvent,
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

  jitter: NonNullable<RetryOptions['jitter']>

  maxElapsedTime: number

  shouldRetry: (
    error: unknown,
    attempt: number
  ) => boolean | Promise<boolean>

  onRetry?: RetryOptions['onRetry']
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
            'retry'
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
        const baseDelay = normalizeRetryDelay(
          retryAfter ?? configuredDelay,
          retryOptions.maxDelay
        )
        const elapsedTime = Math.max(
          0,
          Date.now() - requestContext.startTime
        )
        const pendingEvent = {
          attempt: attempt + 1,
          delay: baseDelay,
          elapsedTime,
          error: requestContext.error
        }
        const jitteredDelay =
          retryAfter === undefined
            ? await applyJitter(
                retryOptions.jitter,
                pendingEvent
              )
            : baseDelay
        const delay = normalizeRetryDelay(
          jitteredDelay,
          retryOptions.maxDelay
        )
        const event = {
          ...pendingEvent,
          delay
        }

        if (
          exceedsElapsedTimeBudget(
            elapsedTime,
            delay,
            retryOptions.maxElapsedTime
          )
        ) {
          return undefined
        }

        notifyRetry(retryOptions.onRetry, event)

        return {
          retry: true,
          delay
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
      jitter: defaults.jitter ?? false,
      maxElapsedTime: normalizeMaxElapsedTime(
        defaults.maxElapsedTime
      ),
      shouldRetry:
        defaults.shouldRetry ?? defaultShouldRetry,
      onRetry: defaults.onRetry
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
    jitter: retry?.jitter ?? defaults.jitter ?? false,
    maxElapsedTime: normalizeMaxElapsedTime(
      retry?.maxElapsedTime ?? defaults.maxElapsedTime
    ),
    shouldRetry:
      retry?.shouldRetry ??
      defaults.shouldRetry ??
      defaultShouldRetry,
    onRetry: retry?.onRetry ?? defaults.onRetry
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

function normalizeMaxElapsedTime(
  maxElapsedTime?: number
): number {
  if (maxElapsedTime === undefined) {
    return Number.POSITIVE_INFINITY
  }

  if (!Number.isFinite(maxElapsedTime)) {
    return maxElapsedTime > 0
      ? Number.POSITIVE_INFINITY
      : 0
  }

  return Math.max(0, maxElapsedTime)
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

async function applyJitter(
  jitter: NonNullable<RetryOptions['jitter']>,
  event: Readonly<RetryEvent>
): Promise<number> {
  if (jitter === false) {
    return event.delay
  }

  if (jitter === true) {
    return Math.random() * event.delay
  }

  return jitter(event)
}

function exceedsElapsedTimeBudget(
  elapsedTime: number,
  delay: number,
  maxElapsedTime: number
): boolean {
  return (
    elapsedTime >= maxElapsedTime ||
    elapsedTime + delay > maxElapsedTime
  )
}

function notifyRetry(
  onRetry: RetryOptions['onRetry'],
  event: Readonly<RetryEvent>
): void {
  if (!onRetry) {
    return
  }

  try {
    void Promise.resolve(onRetry(event)).catch(ignoreRetryObserverError)
  } catch {
    // Retry observers must not change the request lifecycle.
  }
}

function ignoreRetryObserverError(): void {
  // Async observer failures are intentionally isolated.
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
