import type { RequestConfig } from './config'
import type { NporaResponse } from './response'

/**
 * Request adapter.
 */
export interface Adapter {
  /**
   * Send request.
   */
  request<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>>
}
