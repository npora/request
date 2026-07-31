import type {
  HookDisposer,
  HookOptions,
  RequestHook,
  RetryHook
} from '../interceptors/PluginHooks'
import type {
  Interceptor,
  InterceptorOptions
} from '../interceptors'
import type { NporaResponse, RequestConfig } from '../types'

export interface PluginInterceptorManager<T> {
  use(
    interceptor: Interceptor<T>,
    options?: InterceptorOptions
  ): number

  eject(id: number): void
}

export interface PluginHookManager {
  onRequest(
    hook: RequestHook,
    options?: HookOptions
  ): HookDisposer

  onResponse(
    hook: RequestHook,
    options?: HookOptions
  ): HookDisposer

  onError(
    hook: RequestHook,
    options?: HookOptions
  ): HookDisposer

  /**
   * Observe the final request outcome after retries and interceptors finish.
   *
   * Settled hook failures are isolated from the request result.
   */
  onSettled(
    hook: RequestHook,
    options?: HookOptions
  ): HookDisposer

  onRetry(
    hook: RetryHook,
    options?: HookOptions
  ): HookDisposer
}

export interface PluginContext {
  interceptors: {
    request: PluginInterceptorManager<RequestConfig>
    response: PluginInterceptorManager<NporaResponse>
    error: PluginInterceptorManager<unknown>
  }

  hooks: PluginHookManager
}

export type PluginCleanup = () => void

export interface Plugin {
  name: string

  /**
   * Default priority for interceptors and hooks registered by this plugin.
   * Higher priority registrations run first.
   *
   * @default 0
   */
  priority?: number

  /**
   * Plugins that must already be installed.
   */
  requires?: readonly string[]

  /**
   * Plugins that cannot be installed on the same client.
   */
  conflicts?: readonly string[]

  install: (context: PluginContext) => void | PluginCleanup
}
