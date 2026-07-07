import type { RequestConfig } from './config'
import type { NovaResponse } from './response'

/**
 * 请求适配器。
 *
 * Adapter 是 Nova Request 与不同运行时之间的桥梁。
 *
 * 当前默认实现：
 * - Fetch Adapter
 *
 * 后续可扩展：
 * - Node Adapter
 * - Mock Adapter
 * - XHR Adapter
 */
export interface RequestAdapter {

  /**
   * 执行请求。
   */
  (
    config: RequestConfig
  ): Promise<NovaResponse>
}