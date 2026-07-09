import type { RequestContext } from './RequestContext'

export interface RetryDecision {
  retry: boolean
  delay?: number
}

export type RequestHook = (context: RequestContext<any>) => void | Promise<void>

export type RetryHook = (
  context: RequestContext<any>,
  attempt: number
) => RetryDecision | undefined | Promise<RetryDecision | undefined>

export class PluginHooks {
  private readonly requestHooks: RequestHook[] = []
  private readonly responseHooks: RequestHook[] = []
  private readonly errorHooks: RequestHook[] = []
  private readonly retryHooks: RetryHook[] = []

  onRequest(hook: RequestHook): void {
    this.requestHooks.push(hook)
  }

  onResponse(hook: RequestHook): void {
    this.responseHooks.push(hook)
  }

  onError(hook: RequestHook): void {
    this.errorHooks.push(hook)
  }

  onRetry(hook: RetryHook): void {
    this.retryHooks.push(hook)
  }

  async runRequest(context: RequestContext<any>): Promise<void> {
    for (const hook of this.requestHooks) {
      await hook(context)
    }
  }

  async runResponse(context: RequestContext<any>): Promise<void> {
    for (const hook of this.responseHooks) {
      await hook(context)
    }
  }

  async runError(context: RequestContext<any>): Promise<void> {
    for (const hook of this.errorHooks) {
      await hook(context)
    }
  }

  async resolveRetry(
    context: RequestContext<any>,
    attempt: number
  ): Promise<RetryDecision> {
    for (const hook of this.retryHooks) {
      const decision = await hook(context, attempt)

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
