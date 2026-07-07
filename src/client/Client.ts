import { FetchAdapter } from '../adapters'
import { Pipeline, RequestContext } from '../core'
import type { RequestConfig } from '../types'
import { mergeConfig } from '../utils'

/**
 * HTTP Client
 *
 * Client 是 Nova Request 对外提供的统一请求入口。
 * 它只负责组织请求流程，不负责具体请求实现。
 */
export class Client {
  /**
   * 默认请求配置。
   */
  private readonly defaults: Partial<RequestConfig>

  /**
   * 请求执行流水线。
   */
  private readonly pipeline = new Pipeline(new FetchAdapter())

  constructor(defaults: Partial<RequestConfig> = {}) {
    this.defaults = defaults
  }

  /**
   * 执行请求。
   *
   * @param config 请求配置
   */
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const mergedConfig = mergeConfig(this.defaults, config)

    const context = new RequestContext<T>(mergedConfig)

    await this.pipeline.execute(context)

    if (context.error) {
      throw context.error
    }

    if (!context.response) {
      throw new Error('Response is undefined.')
    }

    return context.response.data
  }

  /**
   * GET 请求。
   */
  get<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'GET'
    })
  }

  /**
   * POST 请求。
   */
  post<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'POST'
    })
  }

  /**
   * PUT 请求。
   */
  put<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'PUT'
    })
  }

  /**
   * PATCH 请求。
   */
  patch<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'PATCH'
    })
  }

  /**
   * DELETE 请求。
   */
  delete<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'DELETE'
    })
  }
}
