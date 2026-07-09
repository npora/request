import type { Adapter, NporaResponse, RequestConfig } from '../types'
import type { InterceptorManager } from '../interceptors'
import { RequestContext } from './RequestContext'

export interface PipelineInterceptors {
  request: InterceptorManager<RequestConfig>
  response: InterceptorManager<NporaResponse>
  error: InterceptorManager<unknown>
}

export class Pipeline {
  constructor(
    private readonly adapter: Adapter,
    private readonly interceptors: PipelineInterceptors
  ) {}

  async execute<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    const context = new RequestContext<T>(config)

    try {
      context.config = await this.interceptors.request.run(context.config)

      context.response = await this.adapter.request<T>(context.config)

      context.response = (await this.interceptors.response.run(
        context.response as NporaResponse
      )) as NporaResponse<T>

      return context.response
    } catch (error) {
      context.error = await this.interceptors.error.run(error)

      throw context.error
    } finally {
      context.endTime = Date.now()
    }
  }
}
