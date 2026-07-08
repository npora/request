import type { RequestContext } from './RequestContext'

/**
 * 请求生命周期。
 *
 * 插件可以通过生命周期钩子接入请求流程。
 */
export interface Lifecycle {
  /**
   * 请求发送前触发。
   */
  beforeRequest?: (context: RequestContext<any>) => void | Promise<void>

  /**
   * 响应成功后触发。
   */
  afterResponse?: (context: RequestContext<any>) => void | Promise<void>

  /**
   * 请求失败后触发。
   */
  onError?: (context: RequestContext<any>) => void | Promise<void>
}
