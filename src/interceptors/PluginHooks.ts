import type { RequestContext } from '../core/RequestContext'

export interface RetryDecision {
  retry: boolean
  delay?: number
}

export interface HookOptions {
  /**
   * Higher priority hooks run first.
   *
   * @default 0
   */
  priority?: number
}

export type HookDisposer = () => void

export type RequestHook = (
  context: RequestContext<unknown>
) => void | Promise<void>

export type RetryHook = (
  context: RequestContext<unknown>,
  attempt: number
) => RetryDecision | undefined | Promise<RetryDecision | undefined>

/**
 * Internal plugin lifecycle manager.
 *
 * Hook order is calculated when registrations change so the hot request path
 * can iterate a stable array without allocating and sorting per request.
 */
export class PluginHooks {
  private readonly requestHooks = new HookRegistry<RequestHook>()

  private readonly responseHooks = new HookRegistry<RequestHook>()

  private readonly errorHooks = new HookRegistry<RequestHook>()

  private readonly settledHooks = new HookRegistry<RequestHook>()

  private readonly retryHooks = new HookRegistry<RetryHook>()

  get hasRequestHooks(): boolean {
    return this.requestHooks.active
  }

  get hasResponseHooks(): boolean {
    return this.responseHooks.active
  }

  get hasErrorHooks(): boolean {
    return this.errorHooks.active
  }

  get hasRetryHooks(): boolean {
    return this.retryHooks.active
  }

  get hasSettledHooks(): boolean {
    return this.settledHooks.active
  }

  onRequest(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.requestHooks.register(hook, options)
  }

  onResponse(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.responseHooks.register(hook, options)
  }

  onError(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.errorHooks.register(hook, options)
  }

  onRetry(
    hook: RetryHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.retryHooks.register(hook, options)
  }

  onSettled(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.settledHooks.register(hook, options)
  }

  async runRequest(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.requestHooks.values()) {
      await hook(context)
    }
  }

  async runResponse(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.responseHooks.values()) {
      await hook(context)
    }
  }

  async runError(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.errorHooks.values()) {
      await hook(context)
    }
  }

  async runSettled(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.settledHooks.values()) {
      try {
        await hook(context)
      } catch {
        // Final observers are isolated from each other and the request result.
      }
    }
  }

  async resolveRetry(
    context: RequestContext<unknown>,
    attempt: number
  ): Promise<RetryDecision> {
    for (const hook of this.retryHooks.values()) {
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

interface HookEntry<Hook> {
  id: number
  hook: Hook
  priority: number
}

class HookRegistry<Hook> {
  private id = 0

  private readonly hooks = new Map<number, HookEntry<Hook>>()

  private orderedHooks: Hook[] = []

  get active(): boolean {
    return this.orderedHooks.length > 0
  }

  register(
    hook: Hook,
    options: HookOptions
  ): HookDisposer {
    const id = this.id++

    this.hooks.set(id, {
      id,
      hook,
      priority: normalizePriority(options.priority)
    })
    this.refreshOrder()

    return () => {
      if (this.hooks.delete(id)) {
        this.refreshOrder()
      }
    }
  }

  values(): readonly Hook[] {
    return this.orderedHooks
  }

  private refreshOrder(): void {
    this.orderedHooks = [
      ...this.hooks.values()
    ]
      .sort((first, second) => {
        return (
          second.priority - first.priority ||
          first.id - second.id
        )
      })
      .map(entry => entry.hook)
  }
}

function normalizePriority(priority?: number): number {
  return Number.isFinite(priority) ? priority ?? 0 : 0
}
