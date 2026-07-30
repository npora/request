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

  /**
   * Optional first-attempt fast path for built-in adapters.
   *
   * Custom adapters do not need to implement this method.
   *
   * @internal
   */
  requestValidated?<T = unknown>(
    config: RequestConfig,
    validatedHeaders: Headers,
    preserveRaw?: boolean
  ): Promise<NporaResponse<T>>
}
