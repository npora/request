import type { RequestConfig, NovaResponse } from '../types'
import type { RequestError } from '../errors'

/**
 * Request Context
 *
 * 请求上下文对象。
 *
 * RequestContext 贯穿整个请求生命周期，
 * 所有插件、拦截器、Adapter 都共享同一个上下文。
 */
export class RequestContext<T = unknown> {

  /**
   * 当前请求配置。
   */
  public readonly config: RequestConfig

  /**
   * 请求响应。
   */
  public response?: NovaResponse<T>

  /**
   * 请求异常。
   */
  public error?: RequestError

  /**
   * 请求开始时间。
   */
  public readonly startTime: number

  /**
   * 请求结束时间。
   */
  public endTime?: number

  constructor(config: RequestConfig) {
    this.config = config
    this.startTime = Date.now()
  }

  /**
   * 请求耗时（毫秒）。
   */
  get duration(): number {

    if (!this.endTime) {
      return Date.now() - this.startTime
    }

    return this.endTime - this.startTime
  }
}