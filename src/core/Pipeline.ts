import type {
  InterceptorManager
} from '../interceptors/InterceptorManager'
import type { PluginHooks } from '../interceptors/PluginHooks'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import { RequestContext } from './RequestContext'

export interface PipelineInterceptors {
  request: InterceptorManager<RequestConfig>
  response: InterceptorManager<NporaResponse>
  error: InterceptorManager<unknown>
}

/**
 * Coordinates the request lifecycle.
 *
 * Pipeline does not implement business features.
 */
export class Pipeline {
  constructor(
    private readonly adapter: Adapter,
    private readonly interceptors: PipelineInterceptors,
    private readonly hooks: PluginHooks
  ) {}

  async execute<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    const context = new RequestContext<T>(config)

    try {
      context.config = await this.interceptors.request.run(context.config)

      await this.hooks.runRequest(context)

      if (context.response) {
        return context.response
      }

      let attempt = 0

      while (true) {
        try {
          context.response = await this.adapter.request<T>(context.config)

          context.response = (await this.interceptors.response.run(
            context.response as NporaResponse
          )) as NporaResponse<T>

          await this.hooks.runResponse(context)

          return context.response
        } catch (error) {
          context.error = error

          await this.hooks.runError(context)

          const decision = await this.hooks.resolveRetry(context, attempt)

          if (!decision.retry) {
            context.error = await this.interceptors.error.run(context.error)
            throw context.error
          }

          context.error = undefined
          context.response = undefined
          attempt += 1

          if (decision.delay && decision.delay > 0) {
            await sleep(decision.delay)
          }
        }
      }
    } finally {
      context.endTime = Date.now()
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  })
}
