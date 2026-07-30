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
  interceptor: Interceptor<T>
  priority: number
}

export class InterceptorManager<T> {
  private id = 0

  private readonly interceptors = new Map<number, InterceptorEntry<T>>()

  use(
    interceptor: Interceptor<T>,
    options: InterceptorOptions = {}
  ): number {
    const id = this.id++

    this.interceptors.set(id, {
      interceptor,
      priority: normalizePriority(options.priority)
    })

    return id
  }

  eject(id: number): void {
    this.interceptors.delete(id)
  }

  clear(): void {
    this.interceptors.clear()
  }

  async run(value: T): Promise<T> {
    let result = value

    for (const [, entry] of this.sortedEntries()) {
      result = await entry.interceptor(result)
    }

    return result
  }

  private sortedEntries(): [number, InterceptorEntry<T>][] {
    return [...this.interceptors.entries()].sort(
      ([firstId, first], [secondId, second]) => {
        return (
          second.priority - first.priority ||
          firstId - secondId
        )
      }
    )
  }
}

function normalizePriority(priority?: number): number {
  return Number.isFinite(priority) ? priority ?? 0 : 0
}
