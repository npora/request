import { isPromiseLike } from '../utils/isPromiseLike'
import type { RequestConfig } from '../types'
import { throwIfAborted } from '../utils/createAbortError'
import { waitForPending } from '../utils/waitForSignal'

export type Interceptor<T> = (value: T) => T | Promise<T>

export interface InterceptorOptions {
  /**
   * Higher priority interceptors run first.
   *
   * @default 0
   */
  priority?: number
}

interface InterceptorEntry<T> {
  id: number
  interceptor: Interceptor<T>
  priority: number
}

export class InterceptorManager<T> {
  private id = 0

  private readonly interceptors = new Map<number, InterceptorEntry<T>>()

  private orderedInterceptors: InterceptorEntry<T>[] = []

  get active(): boolean {
    return this.orderedInterceptors.length > 0
  }

  use(
    interceptor: Interceptor<T>,
    options: InterceptorOptions = {}
  ): number {
    const id = this.id++

    this.interceptors.set(id, {
      id,
      interceptor,
      priority: normalizePriority(options.priority)
    })
    this.refreshOrder()

    return id
  }

  eject(id: number): void {
    if (this.interceptors.delete(id)) {
      this.refreshOrder()
    }
  }

  clear(): void {
    this.interceptors.clear()
    this.orderedInterceptors = []
  }

  async run(value: T): Promise<T> {
    return this.runMaybeAsync(value)
  }

  private runMaybeAsync(
    value: T,
    startIndex = 0,
    config?: RequestConfig
  ): T | Promise<T> {
    if (config) throwIfAborted(config)
    let result = value

    for (
      let index = startIndex;
      index < this.orderedInterceptors.length;
      index += 1
    ) {
      const entry = this.orderedInterceptors[index] as InterceptorEntry<T>

      const next = entry.interceptor(result)

      if (isPromiseLike(next)) {
        return waitForPending(next, config).then(resolved => {
          return this.runMaybeAsync(resolved, index + 1, config)
        })
      }

      result = next
      if (config) throwIfAborted(config)
    }

    return result
  }

  private refreshOrder(): void {
    this.orderedInterceptors = [
      ...this.interceptors.values()
    ].sort(
      (first, second) => {
        return (
          second.priority - first.priority ||
          first.id - second.id
        )
      }
    )
  }
}

function normalizePriority(priority?: number): number {
  return Number.isFinite(priority) ? priority ?? 0 : 0
}
