import type { HttpMethod } from './method'

/**
 * URL Query 参数值类型。
 */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined

/**
 * URL Query 参数对象。
 *
 * 示例：
 * {
 *   page: 1,
 *   keyword: 'nova',
 *   tags: ['ts', 'fetch']
 * }
 */
export type QueryParams = Record<
  string,
  QueryValue | QueryValue[]
>

/**
 * HTTP 请求配置。
 *
 * RequestConfig 是整个请求生命周期中的核心配置对象，
 * 所有请求都会围绕该对象进行处理、转换和扩展。
 */
export interface RequestConfig {

  /**
   * 请求地址。
   */
  url: string

  /**
   * HTTP 请求方法。
   *
   * @default 'GET'
   */
  method?: HttpMethod

  /**
   * 请求基础地址。
   */
  baseURL?: string

  /**
   * 请求头。
   */
  headers?: HeadersInit

  /**
   * URL Query 参数。
   */
  query?: QueryParams

  /**
   * 请求体。
   */
  body?: BodyInit | Record<string, unknown> | null

  /**
   * 请求超时时间（毫秒）。
   */
  timeout?: number

  /**
   * AbortSignal，用于取消请求。
   */
  signal?: AbortSignal

  /**
   * Fetch credentials 配置。
   */
  credentials?: RequestCredentials

  /**
   * Fetch mode 配置。
   */
  mode?: RequestMode

  /**
   * Fetch cache 配置。
   */
  cache?: RequestCache
}