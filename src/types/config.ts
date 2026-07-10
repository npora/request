import type { HttpMethod } from './method'

export type QueryValue = string | number | boolean | null | undefined

export type QueryParams = Record<string, QueryValue | QueryValue[]>

export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream'

export interface RetryOptions {
  retries?: number

  delay?:
    | number
    | ((attempt: number, error: unknown) => number | Promise<number>)

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

export interface UploadOptions {
  data: UploadData
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

export interface RequestConfig {
  url: string

  method?: HttpMethod

  baseURL?: string

  headers?: HeadersInit

  query?: QueryParams

  body?: BodyInit | Record<string, unknown> | null

  json?: Record<string, unknown> | unknown[]

  form?: URLSearchParams | Record<string, QueryValue | QueryValue[]>

  formData?: FormData | Record<string, unknown>

  timeout?: number

  signal?: AbortSignal

  responseType?: ResponseType

  validateStatus?: (status: number) => boolean

  retry?: number | RetryOptions

  cache?: CacheOptions

  auth?: AuthOptions

  logger?: LoggerOptions

  upload?: UploadOptions

  download?: DownloadOptions
}
