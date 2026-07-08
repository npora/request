import type { HttpMethod } from './method'

export type QueryValue = string | number | boolean | null | undefined

export type QueryParams = Record<string, QueryValue | QueryValue[]>

export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream'

export type FormDataValue =
  | string
  | number
  | boolean
  | Blob
  | File
  | null
  | undefined

export type FormDataObject = Record<string, FormDataValue | FormDataValue[]>

export interface RetryOptions {
  retries?: number
  delay?: number | ((attempt: number, error: unknown) => number | Promise<number>)
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
}

export interface RequestConfig {
  url: string
  method?: HttpMethod
  baseURL?: string
  headers?: HeadersInit
  query?: QueryParams
  body?: BodyInit | Record<string, unknown> | null
  json?: Record<string, unknown> | unknown[]
  formData?: FormData | FormDataObject
  form?: URLSearchParams | Record<string, QueryValue | QueryValue[]>
  timeout?: number
  signal?: AbortSignal
  responseType?: ResponseType
  validateStatus?: (status: number) => boolean
  retry?: number | RetryOptions
  credentials?: RequestCredentials
  mode?: RequestMode
  cache?: RequestCache
}
