import type { Adapter } from '../adapters'
import { RequestContext } from './RequestContext'

/**
 * Request Pipeline
 *
 * 请求生命周期执行器。
 *
 * Pipeline 负责组织整个请求生命周期，
 * 不负责具体请求实现。
 */
export class Pipeline {
  constructor(
    private readonly adapter: Adapter
  ) {}

  /**
   * 执行请求流水线。
   */
  async execute<T>(
    context: RequestContext<T>
  ): Promise<RequestContext<T>> {

    // Request Lifecycle
    await this.beforeRequest(context)

    // Adapter
    await this.adapter.request(context)

    // Response Lifecycle
    await this.afterResponse(context)

    return context
  }

  /**
   * 请求前生命周期。
   */
  protected async beforeRequest<T>(
    context: RequestContext<T>
  ): Promise<void> {
    void context
  }

  /**
   * 请求后生命周期。
   */
  protected async afterResponse<T>(
    context: RequestContext<T>
  ): Promise<void> {
    void context
  }
}
