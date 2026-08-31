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

export type QuerySerializer = (query: QueryParams) => string

export type RequestURL = string | URL

export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'bytes'
  | 'formData'
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

export type FetchFunction = typeof globalThis.fetch

export interface JsonParserContext {
  /** Final request configuration used for the response. */
  readonly config: RequestConfig

  /** Native response whose buffered JSON body is being parsed. */
  readonly response: Response
}

export type JsonParser = (
  text: string,
  context: JsonParserContext
) => unknown | Promise<unknown>

export type JsonStringifier = (value: unknown) => string

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
  url: RequestURL

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

  /**
   * Fetch-compatible transport function used by the built-in FetchAdapter.
   *
   * @default globalThis.fetch
   */
  fetch?: FetchFunction

  /** Custom parser used for buffered JSON responses. */
  parseJson?: JsonParser

  /** Custom stringifier used for `json` and plain-object request bodies. */
  stringifyJson?: JsonStringifier

  /**
   * Application metadata available throughout the request lifecycle.
   *
   * Context is shallow merged and is never sent over the network.
   */
  context?: Record<string, unknown>

  headers?: HeadersInit

  /**
   * Case-insensitive names of inherited headers to remove.
   *
   * @default []
   */
  removeHeaders?: readonly string[]

  query?: QueryParams

  /** Custom serializer for object query parameters. */
  querySerializer?: QuerySerializer

  searchParams?: URLSearchParams

  body?: BodyInit | Record<string, unknown> | null

  /** Any value accepted by the configured JSON stringifier. */
  json?: unknown

  form?: URLSearchParams | Record<string, QueryValue | QueryValue[]>

  formData?: FormData | Record<string, unknown>

  timeout?: number

  /**
   * Maximum duration for the complete request lifecycle, including hooks,
   * retries, retry delays, parsing, interceptors, and stream consumption.
   *
   * @default disabled
   */
  totalTimeout?: number

  signal?: AbortSignal

  /**
   * Maximum request body size in bytes. Deterministically sized bodies are
   * rejected before dispatch; ReadableStream bodies are limited as consumed.
   *
   * Native FormData cannot be measured without changing its encoding and is
   * therefore not covered.
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
   * Maximum body size parsed into HTTP_ERROR.data. Larger error bodies are
   * not parsed, while status, headers, and the raw response remain available.
   * Set to Infinity to disable this error-body-specific guard.
   *
   * @default 10 MiB
   */
  maxErrorResponseSize?: number

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

  /**
   * Throw `HTTP_ERROR` for responses rejected by the default status policy.
   *
   * Use `validateStatus` instead when a custom status policy is required.
   *
   * @default true
   */
  throwHttpErrors?: boolean

  extensions?: RequestExtensions
}
