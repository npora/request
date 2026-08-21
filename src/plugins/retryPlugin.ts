import { RequestError } from '../errors'
import type {
  HttpMethod,
  RequestConfig,
  RetryEvent,
  RetryOptions
} from '../types'
import type { Plugin } from './Plugin'
import { isPromiseLike } from '../utils/isPromiseLike'
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
  const normalizedDefaults = normalizeRetryOptions(
    undefined,
    defaultOptions
  )

  return {
    name: 'retry',

    install(context) {
      const requestOptions = new WeakMap<object, NormalizedRetryOptions>()

      context.hooks.onRetry((requestContext, attempt) => {
        if (!requestContext.error) {
          return undefined
        }

        let retryOptions = requestOptions.get(requestContext)

        if (!retryOptions) {
          retryOptions = resolveRetryOptions(
            resolveExtensionConfig(
              requestContext.config,
              'retry'
            ),
            normalizedDefaults
          )
          requestOptions.set(requestContext, retryOptions)
        }

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

        const shouldRetry = retryOptions.shouldRetry(
          requestContext.error,
          attempt
        )

        if (isPromiseLike(shouldRetry)) {
          return Promise.resolve(shouldRetry).then(result => {
            return result
              ? createRetryDecision(
                  retryOptions,
                  requestContext.error,
                  requestContext.startTime,
                  attempt
                )
              : undefined
          })
        }

        if (!shouldRetry) {
          return undefined
        }

        return createRetryDecision(
          retryOptions,
          requestContext.error,
          requestContext.startTime,
          attempt
        )
      })
    }
  }
}

function resolveRetryOptions(
  retry: number | RetryOptions | undefined,
  defaults: NormalizedRetryOptions
): NormalizedRetryOptions {
  if (retry === undefined) {
    return defaults
  }

  if (typeof retry === 'number') {
    return {
      ...defaults,
      retries: normalizeRetries(retry)
    }
  }

  return {
    retries:
      retry.retries === undefined
        ? defaults.retries
        : normalizeRetries(retry.retries),
    methods:
      retry.methods === undefined
        ? defaults.methods
        : normalizeMethods(retry.methods),
    delay:
      retry.delay === undefined
        ? defaults.delay
        : normalizeDelay(retry.delay),
    respectRetryAfter:
      retry.respectRetryAfter ?? defaults.respectRetryAfter,
    maxDelay:
      retry.maxDelay === undefined
        ? defaults.maxDelay
        : normalizeMaxDelay(retry.maxDelay),
    jitter: retry.jitter ?? defaults.jitter,
    maxElapsedTime:
      retry.maxElapsedTime === undefined
        ? defaults.maxElapsedTime
        : normalizeMaxElapsedTime(retry.maxElapsedTime),
    shouldRetry: retry.shouldRetry ?? defaults.shouldRetry,
    onRetry: retry.onRetry ?? defaults.onRetry
  }
}

function createRetryDecision(
  options: NormalizedRetryOptions,
  error: unknown,
  startTime: number,
  attempt: number
): { retry: true; delay: number } | undefined | Promise<{
  retry: true
  delay: number
} | undefined> {
  const configuredDelay = options.delay(attempt, error)

  if (isPromiseLike(configuredDelay)) {
    return Promise.resolve(configuredDelay).then(delay => {
      return finalizeRetryDecision(
        options,
        error,
        startTime,
        attempt,
        delay
      )
    })
  }

  return finalizeRetryDecision(
    options,
    error,
    startTime,
    attempt,
    configuredDelay
  )
}

function finalizeRetryDecision(
  options: NormalizedRetryOptions,
  error: unknown,
  startTime: number,
  attempt: number,
  configuredDelay: number
): { retry: true; delay: number } | undefined | Promise<{
  retry: true
  delay: number
} | undefined> {
  const retryAfter = options.respectRetryAfter
    ? parseRetryAfter(error)
    : undefined
  const baseDelay = normalizeRetryDelay(
    retryAfter ?? configuredDelay,
    options.maxDelay
  )

  if (
    (retryAfter !== undefined || options.jitter === false) &&
    options.maxElapsedTime === Number.POSITIVE_INFINITY &&
    !options.onRetry
  ) {
    return {
      retry: true,
      delay: baseDelay
    }
  }

  const elapsedTime = Math.max(0, Date.now() - startTime)
  const pendingEvent = {
    attempt: attempt + 1,
    delay: baseDelay,
    elapsedTime,
    error
  }
  const jitteredDelay =
    retryAfter === undefined
      ? applyJitter(options.jitter, pendingEvent)
      : baseDelay

  if (isPromiseLike(jitteredDelay)) {
    return Promise.resolve(jitteredDelay).then(delay => {
      return completeRetryDecision(options, pendingEvent, delay)
    })
  }

  return completeRetryDecision(options, pendingEvent, jitteredDelay)
}

function completeRetryDecision(
  options: NormalizedRetryOptions,
  pendingEvent: Readonly<RetryEvent>,
  jitteredDelay: number
): { retry: true; delay: number } | undefined {
  const delay = normalizeRetryDelay(jitteredDelay, options.maxDelay)
  const event = {
    ...pendingEvent,
    delay
  }

  if (
    exceedsElapsedTimeBudget(
      pendingEvent.elapsedTime,
      delay,
      options.maxElapsedTime
    )
  ) {
    return undefined
  }

  notifyRetry(options.onRetry, event)

  return {
    retry: true,
    delay
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

function applyJitter(
  jitter: NonNullable<RetryOptions['jitter']>,
  event: Readonly<RetryEvent>
): number | Promise<number> {
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
    const result = onRetry(event)

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(ignoreRetryObserverError)
    }
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
