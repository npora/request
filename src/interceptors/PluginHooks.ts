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

  get active(): boolean {
    return (
      this.requestHooks.active ||
      this.transportHooks.active ||
      this.responseHooks.active ||
      this.errorHooks.active ||
      this.settledHooks.active ||
      this.retryHooks.active
    )
  }

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

  runRequest(context: RequestContext<unknown>): void | Promise<void> {
    return runHooks(this.requestHooks.values(), context)
  }

  runResponse(context: RequestContext<unknown>): void | Promise<void> {
    return runHooks(this.responseHooks.values(), context)
  }

  runTransport(context: RequestContext<unknown>): void | Promise<void> {
    return runTransportHooks(
      this.transportHooks.values(),
      context
    )
  }

  runError(context: RequestContext<unknown>): void | Promise<void> {
    return runHooks(this.errorHooks.values(), context)
  }

  runSettled(context: RequestContext<unknown>): void | Promise<void> {
    return runSettledHooks(
      this.settledHooks.values(),
      context
    )
  }

  resolveRetry(
    context: RequestContext<unknown>,
    attempt: number
  ): RetryDecision | Promise<RetryDecision> {
    return resolveRetryHooks(
      this.retryHooks.values(),
      context,
      attempt
    )
  }
}

const NO_RETRY_DECISION: RetryDecision = {
  retry: false,
  delay: 0
}

function runHooks(
  hooks: readonly RequestHook[],
  context: RequestContext<unknown>,
  startIndex = 0
): void | Promise<void> {
  for (let index = startIndex; index < hooks.length; index += 1) {
    const result = hooks[index]?.(context)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(() => {
        return runHooks(hooks, context, index + 1)
      })
    }
  }
}

function runTransportHooks(
  hooks: readonly RequestHook[],
  context: RequestContext<unknown>,
  startIndex = 0
): void | Promise<void> {
  for (let index = startIndex; index < hooks.length; index += 1) {
    const result = hooks[index]?.(context)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(() => {
        return context.response
          ? undefined
          : runTransportHooks(hooks, context, index + 1)
      })
    }

    if (context.response) {
      return
    }
  }
}

function runSettledHooks(
  hooks: readonly RequestHook[],
  context: RequestContext<unknown>,
  startIndex = 0
): void | Promise<void> {
  for (let index = startIndex; index < hooks.length; index += 1) {
    try {
      const result = hooks[index]?.(context)

      if (isPromiseLike(result)) {
        return Promise.resolve(result)
          .catch(ignoreSettledError)
          .then(() => {
            return runSettledHooks(hooks, context, index + 1)
          })
      }
    } catch {
      // Final observers are isolated from each other and the request result.
    }
  }
}

function resolveRetryHooks(
  hooks: readonly RetryHook[],
  context: RequestContext<unknown>,
  attempt: number,
  startIndex = 0
): RetryDecision | Promise<RetryDecision> {
  for (let index = startIndex; index < hooks.length; index += 1) {
    const result = hooks[index]?.(context, attempt)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(decision => {
        return decision ?? resolveRetryHooks(
          hooks,
          context,
          attempt,
          index + 1
        )
      })
    }

    if (result) {
      return result
    }
  }

  return NO_RETRY_DECISION
}

function ignoreSettledError(): void {}

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
