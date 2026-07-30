import type { HttpMethod } from './method'

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

  shouldRetry?: (
    error: unknown,
    attempt: number
  ) => boolean | Promise<boolean>
}

export interface CacheOptions {
  enabled?: boolean

  ttl?: number

  key?: string
}

export interface AuthOptions {
  token?: string | (() => string | Promise<string>)

  scheme?: string
}

export interface LoggerOptions {
  enabled?: boolean
}

export type UploadData = FormData | Record<string, unknown>

/**
 * Upload progress information.
 */
export interface UploadProgress {
  /**
   * Number of bytes sent.
   */
  loaded: number

  /**
   * Total request size when the browser provides it.
   */
  total?: number

  /**
   * Progress ratio between 0 and 1 when total is available.
   */
  progress?: number
}

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
export interface DownloadProgress {
  /**
   * Number of bytes received.
   */
  loaded: number

  /**
   * Total response size when Content-Length is available.
   */
  total?: number

  /**
   * Progress ratio between 0 and 1 when total is available.
   */
  progress?: number
}

export interface DownloadOptions {
  filename?: string

  /**
   * Called while the response stream is being consumed.
   */
  onProgress?: (progress: DownloadProgress) => void
}
