import type { RequestConfig } from './config'

/**
 * 响应对象。
 *
 * 所有 Adapter 最终都会返回统一的 NovaResponse，
 */
export interface NovaResponse<T = unknown> {
  // 响应数据
  data: T

  /**
   * HTTP 状态码。
   */
  status: number

  /**
   * HTTP 状态描述。
   */
  statusText: string

  /**
   * 响应头。
   */
  headers: Headers

  /**
   * 当前请求配置。
   */
  config: RequestConfig

  /**
   * Fetch Response。
   */
  raw: Response
}