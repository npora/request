import type { HttpMethod } from './method'

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  /**
   * Enable circuit-breaker protection for this request.
   *
   * @default true
   */
  enabled?: boolean

  /**
   * Override the isolation key for this request.
   */
  key?: string
}

export interface CircuitBreakerStateChange {
  key: string

  previousState: CircuitState

  state: CircuitState

  timestamp: number

  failures: number
}

/**
 * Per-request retry configuration used by the retry extension.
 */
export interface RetryOptions {
  retries?: number

  /**
   * HTTP methods that may be retried.
   *
   * @default GET, HEAD, OPTIONS, PUT and DELETE
   */
  methods?: readonly HttpMethod[]

  delay?:
    | number
    | ((attempt: number, error: unknown) => number | Promise<number>)

  /**
   * Respect the server Retry-After response header.
   *
   * @default true
   */
  respectRetryAfter?: boolean

  /**
   * Maximum retry delay in milliseconds.
   *
   * @default 60000
   */
  maxDelay?: number

  /**
   * Randomize the configured retry delay.
   *
   * `true` applies full jitter between zero and the configured delay.
   * A function receives the pending retry event and returns the final delay.
   * Server-provided Retry-After delays are not jittered.
   *
   * @default false
   */
  jitter?:
    | boolean
    | ((event: RetryEvent) => number | Promise<number>)

  /**
   * Maximum elapsed time across the initial request, retries and planned
   * retry delays.
   *
   * @default unlimited
   */
  maxElapsedTime?: number

  shouldRetry?: (
    error: unknown,
    attempt: number
  ) => boolean | Promise<boolean>

  /**
   * Observe a scheduled retry.
   *
   * Callback failures are isolated from the request lifecycle.
   */
  onRetry?: (event: RetryEvent) => void | Promise<void>
}

export interface RetryEvent {
  /**
   * One-based retry number.
   */
  attempt: number

  /**
   * Final delay before this retry in milliseconds.
   */
  delay: number

  /**
   * Time elapsed since the request started in milliseconds.
   */
  elapsedTime: number

  error: unknown
}

export interface CacheOptions {
  enabled?: boolean

  /**
   * Time in milliseconds before a cached response expires.
   * Use `0` to disable persistence or `Infinity` to retain it indefinitely.
   *
   * @default 30000
   */
  ttl?: number

  key?: string

  /**
   * Share one network operation between concurrent equivalent requests.
   *
   * @default true
   */
  dedupe?: boolean
}

export interface ConcurrencyOptions {
  /**
   * Enable concurrency limiting for this request.
   *
   * @default true
   */
  enabled?: boolean

  /**
   * Override the isolation key for this request.
   */
  key?: string

  /**
   * Maximum time in milliseconds this request may wait for a permit.
   *
   * @default the plugin-level queueTimeout
   */
  queueTimeout?: number
}

export interface AuthOptions {
  token?: string | (() => string | Promise<string>)

  scheme?: string
}

export interface LoggerOptions {
  enabled?: boolean

  /**
   * Structured log destination.
   *
   * @default console
   */
  logger?: RequestLogger

  /**
   * Create the identifier shared by all lifecycle entries for a request.
   *
   * @default a plugin-local monotonic identifier
   */
  createRequestId?: () => string
}

export interface RequestLogEntry {
  type: 'request'

  requestId: string

  timestamp: number

  method: HttpMethod

  url: string
}

export interface ResponseLogEntry {
  type: 'response'

  requestId: string

  timestamp: number

  duration: number

  attempts: number

  method: HttpMethod

  url: string

  status: number
}

export interface ErrorLogEntry {
  type: 'error'

  requestId: string

  timestamp: number

  duration: number

  attempt: number

  method: HttpMethod

  url: string

  name: string

  message: string

  code?: string

  status?: number
}

export type LoggerEntry =
  | RequestLogEntry
  | ResponseLogEntry
  | ErrorLogEntry

export interface RequestLogger {
  info(
    message: string,
    entry: RequestLogEntry | ResponseLogEntry
  ): void | Promise<void>

  error(message: string, entry: ErrorLogEntry): void | Promise<void>
}

export type UploadData = FormData | Record<string, unknown>

export interface TransferProgress {
  /**
   * Cumulative number of bytes transferred.
   */
  loaded: number

  /**
   * Total transfer size when the runtime provides it.
   */
  total?: number

  /**
   * Progress ratio between 0 and 1 when total is available.
   */
  progress?: number

  /**
   * Bytes transferred since the previous progress event.
   */
  bytes?: number

  /**
   * Average transfer rate in bytes per second when measurable.
   */
  rate?: number

  /**
   * Estimated remaining seconds when total and rate are available.
   */
  estimated?: number
}

/**
 * Upload progress information.
 */
export interface UploadProgress extends TransferProgress {}

export interface UploadOptions {
  data: UploadData

  /**
   * Called while XMLHttpRequest uploads the request body.
   */
  onProgress?: (progress: UploadProgress) => void
}

/**
 * Download progress information.
 */
export interface DownloadProgress extends TransferProgress {}

export type DownloadOutput = 'blob' | 'stream'

export interface DownloadOptions {
  /**
   * Returned download representation.
   *
   * `stream` requires Fetch response-stream support and preserves backpressure
   * without buffering the complete response in memory.
   *
   * @default 'blob'
   */
  output?: DownloadOutput

  /**
   * Reserved legacy field. It does not save or rename the returned Blob.
   *
   * @deprecated This field currently has no effect.
   */
  filename?: string

  /**
   * Called while the response stream is being consumed.
   */
  onProgress?: (progress: DownloadProgress) => void
}
