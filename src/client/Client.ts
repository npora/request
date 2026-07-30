import { FetchAdapter } from '../adapters'
import { ConfigMerger, Pipeline } from '../core'
import { InterceptorManager } from '../interceptors'
import { PluginHooks } from '../interceptors/PluginHooks'
import type {
  Plugin,
  PluginCleanup
} from '../plugins/Plugin'
import { PluginError } from '../plugins/PluginError'
import { createPluginScope } from '../plugins/PluginScope'
import type {
  Adapter,
  ClientOptions,
  NporaResponse,
  RequestConfig
} from '../types'

export class Client {
  private readonly defaults: Partial<RequestConfig>

  private readonly adapter: Adapter

  private readonly installedPlugins = new Map<
    string,
    InstalledPlugin
  >()

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
    this.adapter = adapter
    this.pipeline = this.createPipeline(adapter)
  }

  /**
   * Create an isolated client that inherits this client's defaults.
   */
  extend(options: ClientOptions = {}): Client {
    const {
      adapter = this.adapter,
      ...overrides
    } = options
    const defaults = ConfigMerger.mergeDefaults(
      this.defaults,
      overrides
    )

    return new Client({
      ...defaults,
      adapter
    })
  }

  use(plugin: Plugin): this {
    if (this.installedPlugins.has(plugin.name)) {
      return this
    }

    this.validatePlugin(plugin)

    const scope = createPluginScope(
      this.interceptors,
      this.hooks,
      plugin.priority
    )

    try {
      const cleanup = plugin.install(scope.context)

      if (cleanup) {
        scope.addCleanup(cleanup)
      }

      this.installedPlugins.set(plugin.name, {
        plugin,
        cleanup: scope.cleanup
      })
    } catch (error) {
      try {
        scope.cleanup()
      } catch {
        // Preserve the original installation error.
      }

      throw error
    }

    return this
  }

  unuse(pluginName: string): this {
    const installed = this.installedPlugins.get(pluginName)

    if (!installed) {
      return this
    }

    const dependent = this.findDependent(pluginName)

    if (dependent) {
      throw new PluginError(
        `Cannot remove plugin "${pluginName}" while "${dependent}" depends on it`,
        {
          code: 'DEPENDENCY_IN_USE',
          plugin: pluginName,
          relatedPlugin: dependent
        }
      )
    }

    try {
      installed.cleanup()
    } finally {
      this.installedPlugins.delete(pluginName)
    }

    return this
  }

  hasPlugin(pluginName: string): boolean {
    return this.installedPlugins.has(pluginName)
  }

  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const response = await this.requestResponse<T>(config)

    return response.data
  }

  async requestResponse<T = unknown>(
    config: RequestConfig
  ): Promise<NporaResponse<T>> {
    const mergedConfig = ConfigMerger.merge(this.defaults, config)
    return this.pipeline.execute<T>(mergedConfig)
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

  getResponse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<T>> {
    return this.requestResponse<T>({
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

  postResponse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<T>> {
    return this.requestResponse<T>({
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

  putResponse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<T>> {
    return this.requestResponse<T>({
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

  patchResponse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<T>> {
    return this.requestResponse<T>({
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

  deleteResponse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<T>> {
    return this.requestResponse<T>({
      ...config,
      url,
      method: 'DELETE'
    })
  }

  head(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<void> {
    return this.request<void>({
      ...config,
      url,
      method: 'HEAD'
    })
  }

  headResponse(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<void>> {
    return this.requestResponse<void>({
      ...config,
      url,
      method: 'HEAD'
    })
  }

  options<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'OPTIONS'
    })
  }

  optionsResponse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'url' | 'method'> = {}
  ): Promise<NporaResponse<T>> {
    return this.requestResponse<T>({
      ...config,
      url,
      method: 'OPTIONS'
    })
  }

  private createPipeline(adapter: Adapter): Pipeline {
    return new Pipeline(adapter, this.interceptors, this.hooks)
  }

  private validatePlugin(plugin: Plugin): void {
    const missingDependency = plugin.requires?.find(name => {
      return !this.installedPlugins.has(name)
    })

    if (missingDependency) {
      throw new PluginError(
        `Plugin "${plugin.name}" requires "${missingDependency}"`,
        {
          code: 'MISSING_DEPENDENCY',
          plugin: plugin.name,
          relatedPlugin: missingDependency
        }
      )
    }

    const directConflict = plugin.conflicts?.find(name => {
      return this.installedPlugins.has(name)
    })

    if (directConflict) {
      throw new PluginError(
        `Plugin "${plugin.name}" conflicts with "${directConflict}"`,
        {
          code: 'PLUGIN_CONFLICT',
          plugin: plugin.name,
          relatedPlugin: directConflict
        }
      )
    }

    for (const installed of this.installedPlugins.values()) {
      if (installed.plugin.conflicts?.includes(plugin.name)) {
        throw new PluginError(
          `Plugin "${plugin.name}" conflicts with "${installed.plugin.name}"`,
          {
            code: 'PLUGIN_CONFLICT',
            plugin: plugin.name,
            relatedPlugin: installed.plugin.name
          }
        )
      }
    }
  }

  private findDependent(pluginName: string): string | undefined {
    for (const installed of this.installedPlugins.values()) {
      if (installed.plugin.requires?.includes(pluginName)) {
        return installed.plugin.name
      }
    }

    return undefined
  }
}

interface InstalledPlugin {
  plugin: Plugin
  cleanup: PluginCleanup
}
