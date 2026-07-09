import { FetchAdapter } from '../adapters'
import { mergeConfig, Pipeline } from '../core'
import { InterceptorManager } from '../interceptors'
import type { Plugin } from '../plugins'
import type { NporaResponse, RequestConfig } from '../types'

export class Client {
  private readonly defaults: Partial<RequestConfig>

  private readonly installedPlugins = new Set<string>()

  public readonly interceptors = {
    request: new InterceptorManager<RequestConfig>(),
    response: new InterceptorManager<NporaResponse>(),
    error: new InterceptorManager<unknown>()
  }

  private readonly pipeline = new Pipeline(
    new FetchAdapter(),
    this.interceptors
  )

  constructor(defaults: Partial<RequestConfig> = {}) {
    this.defaults = defaults
  }

  use(plugin: Plugin): this {
    if (this.installedPlugins.has(plugin.name)) {
      return this
    }

    plugin.install(this)
    this.installedPlugins.add(plugin.name)

    return this
  }

  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const mergedConfig = mergeConfig(this.defaults, config)

    const response = await this.pipeline.execute<T>(mergedConfig)

    return response.data
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
