import type { PluginHooks } from '../interceptors/PluginHooks'
import type { InterceptorManager } from '../interceptors'
import type { NporaResponse, RequestConfig } from '../types'

export interface PluginContext {
  interceptors: {
    request: InterceptorManager<RequestConfig>
    response: InterceptorManager<NporaResponse>
    error: InterceptorManager<unknown>
  }

  hooks: Pick<
    PluginHooks,
    'onRequest' | 'onResponse' | 'onError' | 'onRetry'
  >
}

export interface Plugin {
  name: string

  install: (context: PluginContext) => void
}
