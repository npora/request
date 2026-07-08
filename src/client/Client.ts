import { FetchAdapter } from '../adapters'
import { LifecycleStack, Pipeline, RequestContext } from '../core'
import { InterceptorStack } from '../interceptors'
import type { Plugin } from '../plugins'
import type { NovaResponse, RequestConfig } from '../types'
import { mergeConfig } from '../utils'

export class Client {
  private readonly defaults: Partial<RequestConfig>

  private readonly installedPlugins = new Set<string>()

  private readonly lifecycles = new LifecycleStack()

  public readonly interceptors = {
    request: new InterceptorStack<RequestConfig>(),
    response: new InterceptorStack<NovaResponse>(),
    error: new InterceptorStack<unknown>()
  }

  private readonly pipeline = new Pipeline(
    new FetchAdapter(),
    this.interceptors,
    this.lifecycles
  )

  constructor(defaults: Partial<RequestConfig> = {}) {
    this.defaults = defaults
  }

  use(plugin: Plugin): this {
    if (this.installedPlugins.has(plugin.name)) {
      return this
    }

    plugin.setup?.({
      addLifecycle: lifecycle => {
        this.lifecycles.use(lifecycle)
      }
    })

    this.lifecycles.use(plugin)

    this.installedPlugins.add(plugin.name)

    return this
  }

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
