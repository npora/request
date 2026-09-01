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
  HttpMethod,
  NporaResponse,
  RequestConfig,
  RequestInputConfig,
  RequestURL,
  ServerSentEvent,
  StandardSchemaV1
} from '../types'
import {
  isRequest,
  rememberRequestBody
} from '../utils/isRequest'
import { hasOwnProperty } from '../utils/hasOwnProperty'
import { trustDefaults } from '../core/trustedDefaults'

type MethodConfig = Omit<RequestConfig, 'url' | 'method'>

const EMPTY_METHOD_CONFIG = trustDefaults({}) as MethodConfig

type SchemaMethodConfig<Schema extends StandardSchemaV1> = Omit<
  MethodConfig,
  'schema'
> & {
  schema: Schema
}

type StreamingMethodConfig = Omit<
  RequestConfig,
  'url' | 'method' | 'responseType' | 'schema'
>

type ItemSchemaMethodConfig<Schema extends StandardSchemaV1> = Omit<
  StreamingMethodConfig,
  'itemSchema'
> & {
  itemSchema: Schema
}

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
    const adapter = hasOwnProperty.call(options, 'adapter') &&
      options.adapter !== undefined
      ? options.adapter
      : new FetchAdapter()
    const defaults = { ...options }

    delete defaults.adapter

    this.defaults = Reflect.ownKeys(defaults).length === 0
      ? EMPTY_METHOD_CONFIG
      : trustDefaults(
          ConfigMerger.mergeDefaults(EMPTY_METHOD_CONFIG, defaults)
        )
    this.adapter = adapter
    this.pipeline = this.createPipeline(adapter)
  }

  /**
   * Create an isolated client that inherits this client's defaults.
   */
  extend(options: ClientOptions = {}): Client {
    const adapter = hasOwnProperty.call(options, 'adapter') &&
      options.adapter !== undefined
      ? options.adapter
      : this.adapter
    const overrides = { ...options }

    delete overrides.adapter
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
      (config, dispatchOptions) => {
        return this.pipeline.execute(
          config,
          dispatchOptions?.preserveRaw,
          dispatchOptions?.background
        )
      },
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

  request<Schema extends StandardSchemaV1>(
    config: RequestConfig & { schema: Schema }
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  request<Schema extends StandardSchemaV1>(
    input: Request,
    config: RequestInputConfig & { schema: Schema }
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  request<T = unknown>(config: RequestConfig): Promise<T>

  request<T = unknown>(
    input: Request,
    config?: RequestInputConfig
  ): Promise<T>

  request<T = unknown>(
    input: RequestConfig | Request,
    config: RequestInputConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    try {
      const mergedConfig = this.mergeRequestInput(input, config)

      return this.pipeline.execute<T>(
        mergedConfig,
        false
      ).then(readResponseData)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  requestResponse<Schema extends StandardSchemaV1>(
    config: RequestConfig & { schema: Schema }
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  requestResponse<Schema extends StandardSchemaV1>(
    input: Request,
    config: RequestInputConfig & { schema: Schema }
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  requestResponse<T = unknown>(
    config: RequestConfig
  ): Promise<NporaResponse<T>>

  requestResponse<T = unknown>(
    input: Request,
    config?: RequestInputConfig
  ): Promise<NporaResponse<T>>

  requestResponse<T = unknown>(
    input: RequestConfig | Request,
    config: RequestInputConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    try {
      const mergedConfig = this.mergeRequestInput(input, config)
      return this.pipeline.execute<T>(mergedConfig)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  get<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  get<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  get<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'GET', config)
  }

  getResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  getResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  getResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'GET', config)
  }

  post<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  post<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  post<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'POST', config)
  }

  postResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  postResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  postResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'POST', config)
  }

  put<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  put<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  put<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'PUT', config)
  }

  putResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  putResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  putResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'PUT', config)
  }

  patch<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  patch<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  patch<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'PATCH', config)
  }

  patchResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  patchResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  patchResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'PATCH', config)
  }

  query<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  query<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  query<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'QUERY', config)
  }

  queryResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  queryResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  queryResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'QUERY', config)
  }

  delete<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  delete<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  delete<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'DELETE', config)
  }

  deleteResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  deleteResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  deleteResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'DELETE', config)
  }

  head(
    url: RequestURL,
    config: Omit<MethodConfig, 'schema'> = EMPTY_METHOD_CONFIG
  ): Promise<void> {
    return this.requestMethod<void>(url, 'HEAD', config)
  }

  headResponse(
    url: RequestURL,
    config: Omit<MethodConfig, 'schema'> = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<void>> {
    return this.requestMethodResponse<void>(url, 'HEAD', config)
  }

  options<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<StandardSchemaV1.InferOutput<Schema>>

  options<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<T>

  options<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<T> {
    return this.requestMethod<T>(url, 'OPTIONS', config)
  }

  optionsResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: SchemaMethodConfig<Schema>
  ): Promise<NporaResponse<StandardSchemaV1.InferOutput<Schema>>>

  optionsResponse<T = unknown>(
    url: RequestURL,
    config?: MethodConfig
  ): Promise<NporaResponse<T>>

  optionsResponse<T = unknown>(
    url: RequestURL,
    config: MethodConfig = EMPTY_METHOD_CONFIG
  ): Promise<NporaResponse<T>> {
    return this.requestMethodResponse<T>(url, 'OPTIONS', config)
  }

  /**
   * Consume a server-sent event response as a lazy async iterable.
   */
  sse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: ItemSchemaMethodConfig<Schema>
  ): Promise<AsyncIterable<StandardSchemaV1.InferOutput<Schema>>>

  sse(
    url: RequestURL,
    config?: StreamingMethodConfig
  ): Promise<AsyncIterable<ServerSentEvent>>

  sse(
    url: RequestURL,
    config: StreamingMethodConfig = {}
  ): Promise<AsyncIterable<ServerSentEvent>> {
    return this.get<AsyncIterable<ServerSentEvent>>(url, {
      ...config,
      responseType: 'sse'
    })
  }

  /**
   * Consume a server-sent event response with complete response metadata.
   */
  sseResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: ItemSchemaMethodConfig<Schema>
  ): Promise<NporaResponse<AsyncIterable<
    StandardSchemaV1.InferOutput<Schema>
  >>>

  sseResponse(
    url: RequestURL,
    config?: StreamingMethodConfig
  ): Promise<NporaResponse<AsyncIterable<ServerSentEvent>>>

  sseResponse(
    url: RequestURL,
    config: StreamingMethodConfig = {}
  ): Promise<NporaResponse<AsyncIterable<ServerSentEvent>>> {
    return this.getResponse<AsyncIterable<ServerSentEvent>>(url, {
      ...config,
      responseType: 'sse'
    })
  }

  /**
   * Consume newline-delimited JSON records as a lazy async iterable.
   */
  ndjson<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: ItemSchemaMethodConfig<Schema>
  ): Promise<AsyncIterable<StandardSchemaV1.InferOutput<Schema>>>

  ndjson<T = unknown>(
    url: RequestURL,
    config?: StreamingMethodConfig
  ): Promise<AsyncIterable<T>>

  ndjson<T = unknown>(
    url: RequestURL,
    config: StreamingMethodConfig = {}
  ): Promise<AsyncIterable<T>> {
    return this.get<AsyncIterable<T>>(url, {
      ...config,
      responseType: 'ndjson'
    })
  }

  /**
   * Consume newline-delimited JSON with complete response metadata.
   */
  ndjsonResponse<Schema extends StandardSchemaV1>(
    url: RequestURL,
    config: ItemSchemaMethodConfig<Schema>
  ): Promise<NporaResponse<AsyncIterable<
    StandardSchemaV1.InferOutput<Schema>
  >>>

  ndjsonResponse<T = unknown>(
    url: RequestURL,
    config?: StreamingMethodConfig
  ): Promise<NporaResponse<AsyncIterable<T>>>

  ndjsonResponse<T = unknown>(
    url: RequestURL,
    config: StreamingMethodConfig = {}
  ): Promise<NporaResponse<AsyncIterable<T>>> {
    return this.getResponse<AsyncIterable<T>>(url, {
      ...config,
      responseType: 'ndjson'
    })
  }

  private requestMethod<T>(
    url: RequestURL,
    method: HttpMethod,
    config: MethodConfig
  ): Promise<T> {
    if (this.request !== Client.prototype.request) {
      return this.request<T>({
        ...config,
        url,
        method
      })
    }

    try {
      return this.pipeline.execute<T>(
        this.mergeMethodConfig(url, method, config),
        false
      ).then(readResponseData)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private requestMethodResponse<T>(
    url: RequestURL,
    method: HttpMethod,
    config: MethodConfig
  ): Promise<NporaResponse<T>> {
    if (this.requestResponse !== Client.prototype.requestResponse) {
      return this.requestResponse<T>({
        ...config,
        url,
        method
      })
    }

    try {
      return this.pipeline.execute<T>(
        this.mergeMethodConfig(url, method, config)
      )
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private mergeMethodConfig(
    url: RequestURL,
    method: HttpMethod,
    config: MethodConfig
  ): RequestConfig {
    if (
      this.defaults === EMPTY_METHOD_CONFIG &&
      config === EMPTY_METHOD_CONFIG
    ) {
      return { url, method }
    }

    const merged = ConfigMerger.merge(
      this.defaults,
      config as RequestConfig
    )

    merged.url = url
    merged.method = method

    return merged
  }

  private mergeRequestInput(
    input: RequestConfig | Request,
    overrides: RequestInputConfig
  ): RequestConfig {
    if (!isRequest(input)) {
      return ConfigMerger.merge(this.defaults, input)
    }

    const requestConfig = requestToConfig(input)
    const merged = ConfigMerger.merge(this.defaults, requestConfig)

    if (overrides === EMPTY_METHOD_CONFIG) {
      return merged
    }

    return ConfigMerger.merge(merged, {
      ...overrides,
      url: requestConfig.url
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

function requestToConfig(
  input: Request,
  body: ReadableStream<Uint8Array> | null = input.body
): RequestConfig {
  const config: RequestConfig = {
    url: input.url,
    method: input.method as HttpMethod,
    headers: input.headers,
    body,
    signal: input.signal,
    fetchOptions: {
      cache: input.cache,
      credentials: input.credentials,
      integrity: input.integrity,
      keepalive: input.keepalive,
      mode: input.mode,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy
    }
  }

  rememberRequestBody(config, input, body)

  return config
}

interface InstalledPlugin {
  plugin: Plugin
  cleanup: PluginCleanup
}

function readResponseData<T>(response: NporaResponse<T>): T {
  return response.data
}
