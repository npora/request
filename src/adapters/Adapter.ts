import type { RequestContext } from '../core'

/**
 * 请求适配器。
 *
 * Adapter 是 Nova Request 与具体运行时之间的桥梁。
 *
 * 核心层调用 Adapter。
 */
export interface Adapter {

  /**
   * 执行请求。
   *
   * @param context 请求上下文
   */
  request<T = unknown>(
    context: RequestContext<T>
  ): Promise<void>
}