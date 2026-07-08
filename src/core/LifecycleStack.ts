import type { Lifecycle, RetryDecision } from './Lifecycle'
import type { RequestContext } from './RequestContext'

export class LifecycleStack {
  private readonly lifecycles: Lifecycle[] = []

  use(lifecycle: Lifecycle): void {
    this.lifecycles.push(lifecycle)
  }

  async runBeforeRequest<T>(context: RequestContext<T>): Promise<void> {
    for (const lifecycle of this.lifecycles) {
      await lifecycle.beforeRequest?.(context)
    }
  }

  async runAfterResponse<T>(context: RequestContext<T>): Promise<void> {
    for (const lifecycle of this.lifecycles) {
      await lifecycle.afterResponse?.(context)
    }
  }

  async runError<T>(context: RequestContext<T>): Promise<void> {
    for (const lifecycle of this.lifecycles) {
      await lifecycle.onError?.(context)
    }
  }

  async resolveRetry<T>(
    context: RequestContext<T>,
    attempt: number
  ): Promise<RetryDecision> {
    for (const lifecycle of this.lifecycles) {
      const decision = await lifecycle.resolveRetry?.(context, attempt)

      if (decision) {
        return decision
      }
    }

    return {
      retry: false,
      delay: 0
    }
  }
}
