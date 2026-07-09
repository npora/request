import type { HttpMethod } from './method'

/**
 * URL query value.
 */
export type QueryValue = string | number | boolean | null | undefined

/**
 * URL query parameters.
 */
export type QueryParams = Record<string, QueryValue | QueryValue[]>

/**
 * Response parse type.
 */
export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream'

/**
 * Request configuration.
 */
export interface RequestConfig {
  /**
   * Request URL.
   */
  url: string

  /**
   * HTTP method.
   */
  method?: HttpMethod

  /**
   * Base URL.
   */
  baseURL?: string

  /**
   * Request headers.
   */
  headers?: HeadersInit

  /**
   * URL query parameters.
   */
  query?: QueryParams

  /**
   * Raw request body.
   */
  body?: BodyInit | Record<string, unknown> | null

  /**
   * JSON request body.
   */
  json?: Record<string, unknown> | unknown[]

  /**
   * URL encoded form body.
   */
  form?: URLSearchParams | Record<string, QueryValue | QueryValue[]>

  /**
   * FormData body.
   */
  formData?: FormData | Record<string, unknown>

  /**
   * Request timeout in milliseconds.
   */
  timeout?: number

  /**
   * Abort signal.
   */
  signal?: AbortSignal

  /**
   * Response parse type.
   */
  responseType?: ResponseType

  /**
   * Validate response status.
   */
  validateStatus?: (status: number) => boolean
}
