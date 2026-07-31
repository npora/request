import type { HttpMethod } from './method'
import type {
  AuthOptions,
  CacheOptions,
  DownloadOptions,
  LoggerOptions,
  RetryOptions,
  UploadOptions
} from './extensions'

export type QueryValue = string | number | boolean | null | undefined

export type QueryParams = Record<string, QueryValue | QueryValue[]>

export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream'

/**
 * Native Fetch options passed to the underlying adapter.
 *
 * Request fields managed by Npora Request are intentionally omitted so there
 * is a single source of truth for method, headers, body and cancellation.
 */
export type FetchOptions = Omit<
  RequestInit,
  'method' | 'headers' | 'body' | 'signal'
>

/**
 * Plugin-owned request configuration.
 *
 * Plugins extend this interface through TypeScript module augmentation.
 */
export interface RequestExtensions {
  auth?: AuthOptions

  cache?: CacheOptions

  download?: DownloadOptions

  logger?: LoggerOptions

  retry?: number | RetryOptions

  upload?: UploadOptions
}

export interface RequestConfig {
  url: string

  method?: HttpMethod

  baseURL?: string

  fetchOptions?: FetchOptions

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

  extensions?: RequestExtensions
}
