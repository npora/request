import { isRequestError, RequestError } from '../errors'
import type {
  HttpMethod,
  RequestConfig,
  RetryEvent,
  RetryOptions
} from '../types'
import type { Plugin } from './Plugin'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { isReadableStream } from '../utils/isReadableStream'

const DEFAULT_RETRY_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD',
  'OPTIONS',
  'QUERY',
  'PUT',
  'DELETE'
]

interface NormalizedRetryOptions {
  retries: number

  methods: ReadonlySet<HttpMethod>

  statusCodes?: ReadonlySet<number>

  retryOnTimeout: boolean

  delay: (
    attempt: number,
    error: unknown
  ) => number | Promise<number>

  respectRetryAfter: boolean

  maxDelay: number

  jitter: NonNullable<RetryOptions['jitter']>

  maxElapsedTime: number

  shouldRetry?: RetryOptions['shouldRetry']

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
          const override = resolveExtensionConfig(
            requestContext.config,
            'retry'
          )

          retryOptions = resolveRetryOptions(
            override,
            normalizedDefaults
          )

          if (override) {
            requestOptions.set(requestContext, retryOptions)
          }
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

        const shouldRetry = resolveShouldRetry(
          retryOptions,
          requestContext.error,
          attempt
        )

        if (isPromiseLike(shouldRetry)) {
          const decision = Promise.resolve(shouldRetry).then(result => {
            return result
              ? createRetryDecision(
                  retryOptions,
                  requestContext.error,
                  requestContext.startTime,
                  attempt
                )
              : undefined
          })

          return requestContext.config.signal
            ? waitForSignal(() => decision, requestContext.config)
            : decision
        }

        if (!shouldRetry) {
          return undefined
        }

        const decision = createRetryDecision(
          retryOptions,
          requestContext.error,
          requestContext.startTime,
          attempt
        )

        return requestContext.config.signal && isPromiseLike(decision)
          ? waitForSignal(() => decision, requestContext.config)
          : decision
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
    statusCodes:
      retry.statusCodes === undefined
        ? defaults.statusCodes
        : normalizeStatusCodes(retry.statusCodes),
    retryOnTimeout:
      retry.retryOnTimeout ?? defaults.retryOnTimeout,
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
  const serverDelay = options.respectRetryAfter
    ? parseServerRetryDelay(error)
    : undefined
  const baseDelay = normalizeRetryDelay(
    serverDelay ?? configuredDelay,
    options.maxDelay
  )

  if (
    (serverDelay !== undefined || options.jitter === false) &&
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
    serverDelay === undefined
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
      statusCodes: normalizeStatusCodes(defaults.statusCodes),
      retryOnTimeout: defaults.retryOnTimeout ?? true,
      delay: normalizeDelay(defaults.delay),
      respectRetryAfter:
        defaults.respectRetryAfter ?? true,
      maxDelay: normalizeMaxDelay(defaults.maxDelay),
      jitter: defaults.jitter ?? false,
      maxElapsedTime: normalizeMaxElapsedTime(
        defaults.maxElapsedTime
      ),
      shouldRetry: defaults.shouldRetry,
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
    statusCodes: normalizeStatusCodes(
      retry?.statusCodes ?? defaults.statusCodes
    ),
    retryOnTimeout:
      retry?.retryOnTimeout ?? defaults.retryOnTimeout ?? true,
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
    shouldRetry: retry?.shouldRetry ?? defaults.shouldRetry,
    onRetry: retry?.onRetry ?? defaults.onRetry
  }
}

function normalizeMethods(
  methods?: readonly HttpMethod[]
): ReadonlySet<HttpMethod> {
  return new Set(methods ?? DEFAULT_RETRY_METHODS)
}

function normalizeStatusCodes(
  statusCodes?: readonly number[]
): ReadonlySet<number> | undefined {
  return statusCodes ? new Set(statusCodes) : undefined
}

function normalizeMaxDelay(maxDelay?: number): number {
  if (maxDelay === undefined) {
    return 60000
  }

  if (!Number.isFinite(maxDelay)) {
    return maxDelay > 0 ? MAX_TIMER_DELAY : 0
  }

  return Math.min(Math.max(0, maxDelay), MAX_TIMER_DELAY)
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

function parseServerRetryDelay(error: unknown): number | undefined {
  if (!isRequestError(error)) {
    return undefined
  }

  const timing = getServerRetryTiming(error.response?.headers)

  if (!timing) {
    return undefined
  }

  const { value, allowTimestamp } = timing

  if (/^\d+$/.test(value)) {
    let delay = Number(value) * 1000

    if (
      allowTimestamp &&
      delay >= Date.parse('2024-01-01T00:00:00Z')
    ) {
      delay -= Date.now()
    }

    return Math.max(0, delay)
  }

  if (
    !value.includes(':') ||
    !/^(Mo|T[uh]|We|Fr|S[au])/.test(value)
  ) {
    return undefined
  }

  const date = Date.parse(value)

  if (Number.isNaN(date)) {
    return undefined
  }

  return Math.max(0, date - Date.now())
}

function getServerRetryTiming(
  headers: Headers | undefined
): { value: string; allowTimestamp: boolean } | undefined {
  if (!headers) {
    return undefined
  }

  const retryAfter = headers.get('retry-after')

  if (retryAfter !== null) {
    return { value: retryAfter, allowTimestamp: false }
  }

  const rateLimitReset = headers.get('ratelimit-reset')

  if (rateLimitReset !== null) {
    return { value: rateLimitReset, allowTimestamp: true }
  }

  const rateLimitRetryAfter = headers.get('x-ratelimit-retry-after')

  if (rateLimitRetryAfter !== null) {
    return { value: rateLimitRetryAfter, allowTimestamp: false }
  }

  const rateLimitResetAlias =
    headers.get('x-ratelimit-reset') ??
    headers.get('x-rate-limit-reset')

  return rateLimitResetAlias === null
    ? undefined
    : { value: rateLimitResetAlias, allowTimestamp: true }
}

function resolveShouldRetry(
  options: NormalizedRetryOptions,
  error: unknown,
  attempt: number
): boolean | Promise<boolean> {
  const decision = options.shouldRetry?.(error, attempt)

  return isPromiseLike(decision)
    ? Promise.resolve(decision).then(result => {
        return result ?? defaultShouldRetry(error, options)
      })
    : decision ?? defaultShouldRetry(error, options)
}

function defaultShouldRetry(
  error: unknown,
  options: NormalizedRetryOptions
): boolean {
  if (!isRequestError(error)) {
    return false
  }

  if (error.code === 'NETWORK_ERROR') {
    return true
  }

  if (error.code === 'TIMEOUT_ERROR') {
    return options.retryOnTimeout
  }

  if (error.status === undefined) {
    return false
  }

  if (error.status === 413) {
    return isRetryStatus(413, options) &&
      parseServerRetryDelay(error) !== undefined
  }

  return isRetryStatus(error.status, options)
}

function isRetryStatus(
  status: number,
  options: NormalizedRetryOptions
): boolean {
  return options.statusCodes
    ? options.statusCodes.has(status)
    : (
        status === 408 ||
        status === 413 ||
        status === 425 ||
        status === 429 ||
        status >= 500
      )
}
