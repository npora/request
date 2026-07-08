import { FetchAdapter } from '../adapters'
import { Pipeline, RequestContext } from '../core'
import { InterceptorStack } from '../interceptors'
import type { Plugin } from '../plugins'
import type { NovaResponse, RequestConfig } from '../types'
import { mergeConfig } from '../utils'

/**
 * HTTP Client
 *
 * Client 是 Npora Request 对外提供的统一请求入口。
 */
export class Client {
  /**
   * 默认请求配置。
   */
  private readonly defaults: Partial<RequestConfig>

  /**
   * 已安装插件名称集合。
   */
  private readonly installedPlugins = new Set<string>()

  /**
   * 拦截器。
   */
  public readonly interceptors = {
    request: new InterceptorStack<RequestConfig>(),
    response: new InterceptorStack<NovaResponse>(),
    error: new InterceptorStack<unknown>()
  }

  /**
   * 请求执行流水线。
   */
  private readonly pipeline = new Pipeline(
    new FetchAdapter(),
    this.interceptors
  )

  constructor(defaults: Partial<RequestConfig> = {}) {
    this.defaults = defaults
  }

  /**
   * 安装插件。
   */
  use(plugin: Plugin): this {
    if (this.installedPlugins.has(plugin.name)) {
      return this
    }

    plugin.install(this)
    this.installedPlugins.add(plugin.name)

    return this
  }

  /**
   * 执行请求。
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
