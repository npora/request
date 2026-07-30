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
 * It coordinates plugin hooks without exposing Client internals.
 */
export class PluginHooks {
  private id = 0

  private readonly requestHooks = new Map<number, HookEntry<RequestHook>>()

  private readonly responseHooks = new Map<number, HookEntry<RequestHook>>()

  private readonly errorHooks = new Map<number, HookEntry<RequestHook>>()

  private readonly retryHooks = new Map<number, HookEntry<RetryHook>>()

  onRequest(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.register(this.requestHooks, hook, options)
  }

  onResponse(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.register(this.responseHooks, hook, options)
  }

  onError(
    hook: RequestHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.register(this.errorHooks, hook, options)
  }

  onRetry(
    hook: RetryHook,
    options: HookOptions = {}
  ): HookDisposer {
    return this.register(this.retryHooks, hook, options)
  }

  async runRequest(context: RequestContext<unknown>): Promise<void> {
    for (const entry of sortedHooks(this.requestHooks)) {
      await entry.hook(context)
    }
  }

  async runResponse(context: RequestContext<unknown>): Promise<void> {
    for (const entry of sortedHooks(this.responseHooks)) {
      await entry.hook(context)
    }
  }

  async runError(context: RequestContext<unknown>): Promise<void> {
    for (const entry of sortedHooks(this.errorHooks)) {
      await entry.hook(context)
    }
  }

  async resolveRetry(
    context: RequestContext<unknown>,
    attempt: number
  ): Promise<RetryDecision> {
    for (const entry of sortedHooks(this.retryHooks)) {
      const decision = await entry.hook(context, attempt)

      if (decision) {
        return decision
      }
    }

    return {
      retry: false,
      delay: 0
    }
  }

  private register<Hook>(
    hooks: Map<number, HookEntry<Hook>>,
    hook: Hook,
    options: HookOptions
  ): HookDisposer {
    const id = this.id++

    hooks.set(id, {
      hook,
      priority: normalizePriority(options.priority)
    })

    return () => {
      hooks.delete(id)
    }
  }
}

interface HookEntry<Hook> {
  hook: Hook
  priority: number
}

function sortedHooks<Hook>(
  hooks: Map<number, HookEntry<Hook>>
): HookEntry<Hook>[] {
  return [...hooks.entries()]
    .sort(([firstId, first], [secondId, second]) => {
      return (
        second.priority - first.priority ||
        firstId - secondId
      )
    })
    .map(([, entry]) => entry)
}

function normalizePriority(priority?: number): number {
  return Number.isFinite(priority) ? priority ?? 0 : 0
}
