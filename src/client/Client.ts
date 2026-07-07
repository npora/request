import { FetchAdapter } from '../adapters'
import { RequestContext } from '../core'
import type { RequestConfig } from '../types'

/**
 * HTTP Client
 *
 * Nova Request 对外提供的统一请求入口。
 */
export class Client {
  /**
   * 默认请求配置。
   */
  private readonly defaults: Partial<RequestConfig>

  /**
   * 默认请求适配器。
   */
  private readonly adapter = new FetchAdapter()

  constructor(defaults: Partial<RequestConfig> = {}) {
    this.defaults = defaults
  }

  /**
   * 执行请求。
   */
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const mergedConfig: RequestConfig = {
      ...this.defaults,
      ...config,
      headers: {
        ...this.defaults.headers,
        ...config.headers
      }
    }

    const context = new RequestContext<T>(mergedConfig)

    await this.adapter.request(context)

    if (context.error) {
      throw context.error
    }

    return context.response!.data
  }

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
}