import type { Adapter } from '../adapters'
import type { InterceptorStack } from '../interceptors'
import type { NovaResponse, RequestConfig } from '../types'
import { sleep } from '../utils'
import type { LifecycleStack } from './LifecycleStack'
import { RequestContext } from './RequestContext'
import { normalizeRetryOptions } from './retry'

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

    const retryOptions = normalizeRetryOptions(context.config.retry)

    for (let attempt = 0; attempt <= retryOptions.retries; attempt++) {
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

      const canRetry =
        attempt < retryOptions.retries &&
        (await retryOptions.shouldRetry(context.error, attempt))

      if (!canRetry) {
        context.error = await this.interceptors.error.run(context.error)

        await this.lifecycles.runError(context)

        return context
      }

      const delay = await retryOptions.delay(attempt, context.error)

      context.error = undefined
      context.response = undefined

      if (delay > 0) {
        await sleep(delay)
      }
    }

    return context
  }
}
