import type { Adapter } from '../adapters'
import type { InterceptorStack } from '../interceptors'
import type { NovaResponse, RequestConfig } from '../types'
import { sleep } from '../utils'
import type { LifecycleStack } from './LifecycleStack'
import { RequestContext } from './RequestContext'

export interface PipelineInterceptors {
  request: InterceptorStack<RequestConfig>
  response: InterceptorStack<NovaResponse>
  error: InterceptorStack<unknown>
}

export class Pipeline {
  constructor(
    private readonly adapter: Adapter,
    private readonly interceptors: PipelineInterceptors,
    private readonly lifecycles: LifecycleStack
  ) {}

  async execute<T>(context: RequestContext<T>): Promise<RequestContext<T>> {
    context.config = await this.interceptors.request.run(context.config)

    await this.lifecycles.runBeforeRequest(context)

    let attempt = 0

    while (true) {
      await this.adapter.request(context)

      if (!context.error) {
        if (context.response) {
          context.response = (await this.interceptors.response.run(
            context.response as NovaResponse
          )) as NovaResponse<T>
        }

        await this.lifecycles.runAfterResponse(context)

        return context
      }

      const retryDecision = await this.lifecycles.resolveRetry(context, attempt)

      if (!retryDecision.retry) {
        context.error = await this.interceptors.error.run(context.error)

        await this.lifecycles.runError(context)

        return context
      }

      context.error = undefined
      context.response = undefined

      if (retryDecision.delay && retryDecision.delay > 0) {
        await sleep(retryDecision.delay)
      }

      attempt++
    }
  }
}
