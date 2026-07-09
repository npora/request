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

  delay?: number | ((attempt: number, error: unknown) => number | Promise<number>)

  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
}

export interface CacheOptions {
  enabled?: boolean

  ttl?: number

  key?: string
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
}
