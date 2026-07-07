import type { RequestConfig } from './config'
import type { NovaResponse } from './response'

/**
 * 请求拦截器。
 *
 * 在请求发送前执行。
 */
export type RequestInterceptor = (
  config: RequestConfig
) => RequestConfig | Promise<RequestConfig>

/**
 * 响应拦截器。
 *
 * 在请求成功后执行。
 */
export type ResponseInterceptor<T = unknown> = (
  response: NovaResponse<T>
) => NovaResponse<T> | Promise<NovaResponse<T>>

/**
 * 错误拦截器。
 *
 * 在请求失败时执行。
 */
export type ErrorInterceptor = (
  error: unknown
) => unknown | Promise<unknown>