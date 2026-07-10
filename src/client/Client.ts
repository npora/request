import { FetchAdapter } from '../adapters'
import { ConfigMerger, Pipeline } from '../core'
import { InterceptorManager } from '../interceptors'
import { PluginHooks } from '../interceptors/PluginHooks'
import type { Plugin } from '../plugins'
import type {
  Adapter,
  ClientOptions,
  NporaResponse,
  RequestConfig
} from '../types'

export class Client {
  private readonly defaults: Partial<RequestConfig>

  private readonly installedPlugins = new Set<string>()

  private readonly hooks = new PluginHooks()

  public readonly interceptors = {
    request: new InterceptorManager<RequestConfig>(),
    response: new InterceptorManager<NporaResponse>(),
    error: new InterceptorManager<unknown>()
  }

  private readonly pipeline: Pipeline

  constructor(options: ClientOptions = {}) {
    const { adapter = new FetchAdapter(), ...defaults } = options

    this.defaults = defaults
    this.pipeline = this.createPipeline(adapter)
  }

  use(plugin: Plugin): this {
    if (this.installedPlugins.has(plugin.name)) {
      return this
    }

    plugin.install({
      interceptors: this.interceptors,
      hooks: this.hooks
    })

    this.installedPlugins.add(plugin.name)

    return this
  }

  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const mergedConfig = ConfigMerger.merge(this.defaults, config)
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

  private createPipeline(adapter: Adapter): Pipeline {
    return new Pipeline(adapter, this.interceptors, this.hooks)
  }
}
