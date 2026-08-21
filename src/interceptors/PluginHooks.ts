import type { RequestContext } from '../core/RequestContext'
import { isPromiseLike } from '../utils/isPromiseLike'

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

  private readonly transportHooks = new HookRegistry<RequestHook>()

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

  get hasTransportHooks(): boolean {
    return this.transportHooks.active
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

  onTransport(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.transportHooks.register(hook, options)
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
      const result = hook(context)

      if (isPromiseLike(result)) {
        await result
      }
    }
  }

  async runResponse(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.responseHooks.values()) {
      const result = hook(context)

      if (isPromiseLike(result)) {
        await result
      }
    }
  }

  async runTransport(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.transportHooks.values()) {
      const result = hook(context)

      if (isPromiseLike(result)) {
        await result
      }

      if (context.response) {
        return
      }
    }
  }

  async runError(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.errorHooks.values()) {
      const result = hook(context)

      if (isPromiseLike(result)) {
        await result
      }
    }
  }

  async runSettled(context: RequestContext<unknown>): Promise<void> {
    for (const hook of this.settledHooks.values()) {
      try {
        const result = hook(context)

        if (isPromiseLike(result)) {
          await result
        }
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
      const result = hook(context, attempt)
      const decision = isPromiseLike(result)
        ? await result
        : result

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
