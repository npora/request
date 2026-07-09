import type { Adapter, NporaResponse, RequestConfig } from '../types'
import type { InterceptorManager } from '../interceptors'
import type { PluginHooks } from './PluginHooks'
import { RequestContext } from './RequestContext'

export interface PipelineInterceptors {
  request: InterceptorManager<RequestConfig>
  response: InterceptorManager<NporaResponse>
  error: InterceptorManager<unknown>
}

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

          const retryDecision = await this.hooks.resolveRetry(context, attempt)

          if (!retryDecision.retry) {
            context.error = await this.interceptors.error.run(context.error)

            throw context.error
          }

          context.error = undefined
          context.response = undefined

          if (retryDecision.delay && retryDecision.delay > 0) {
            await sleep(retryDecision.delay)
          }

          attempt++
        }
      }
    } finally {
      context.endTime = Date.now()
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
