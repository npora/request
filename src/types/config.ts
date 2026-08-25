import type { HttpMethod } from './method'
import type { StandardSchemaV1 } from './standardSchema'
import type {
  AuthOptions,
  CacheOptions,
  CircuitBreakerOptions,
  ConcurrencyOptions,
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
  | 'sse'
  | 'ndjson'

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

  circuitBreaker?: CircuitBreakerOptions

  concurrency?: ConcurrencyOptions

  download?: DownloadOptions

  logger?: LoggerOptions

  retry?: number | RetryOptions

  upload?: UploadOptions
}

export interface RequestConfig {
  url: string

  method?: HttpMethod

  baseURL?: string

  /**
   * Allow an absolute request URL to bypass `baseURL`.
   *
   * Disable this when `baseURL` defines the trusted request boundary.
   *
   * @default true
   */
  allowAbsoluteUrls?: boolean

  fetchOptions?: FetchOptions

  headers?: HeadersInit

  query?: QueryParams

  searchParams?: URLSearchParams

  body?: BodyInit | Record<string, unknown> | null

  json?: Record<string, unknown> | unknown[]

  form?: URLSearchParams | Record<string, QueryValue | QueryValue[]>

  formData?: FormData | Record<string, unknown>

  timeout?: number

  signal?: AbortSignal

  /**
   * Maximum request body size in bytes when the serialized size can be
   * determined before dispatch.
   *
   * FormData and ReadableStream bodies cannot be preflighted without
   * buffering and are therefore not covered.
   *
   * @default unlimited
   */
  maxRequestSize?: number

  /**
   * Maximum parsed response body size in bytes.
   *
   * @default unlimited
   */
  maxResponseSize?: number

  /**
   * Maximum nested array depth accepted while building FormData.
   *
   * @default 32
   */
  maxFormDataDepth?: number

  responseType?: ResponseType

  /**
   * Validate and optionally transform the parsed response value.
   *
   * Accepts any Standard Schema v1 compatible validator.
   */
  schema?: StandardSchemaV1

  validateStatus?: (status: number) => boolean

  extensions?: RequestExtensions
}
