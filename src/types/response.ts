import type { RequestConfig } from './config'

/**
 * Npora response.
 */
export interface NporaResponse<T = unknown> {
  /**
   * Parsed response data.
   */
  data: T

  /**
   * HTTP status code.
   */
  status: number

  /**
   * HTTP status text.
   */
  statusText: string

  /**
   * Response headers.
   */
  headers: Headers

  /**
   * Request config.
   */
  config: RequestConfig

  /**
   * Raw Fetch Response.
   */
  raw: Response
}
