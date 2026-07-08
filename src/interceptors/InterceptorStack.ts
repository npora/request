/**
 * 拦截器函数。
 */
export type Interceptor<T> = (value: T) => T | Promise<T>

/**
 * 拦截器栈。
 */
export class InterceptorStack<T> {
  private id = 0

  private readonly interceptors = new Map<number, Interceptor<T>>()

  /**
   * 注册拦截器。
   */
  use(interceptor: Interceptor<T>): number {
    const id = this.id++

    this.interceptors.set(id, interceptor)

    return id
  }

  /**
   * 移除拦截器。
   */
  eject(id: number): void {
    this.interceptors.delete(id)
  }

  /**
   * 清空拦截器。
   */
  clear(): void {
    this.interceptors.clear()
  }

  /**
   * 依次执行拦截器。
   */
  async run(value: T): Promise<T> {
    let result = value

    for (const interceptor of this.interceptors.values()) {
      result = await interceptor(result)
    }

    return result
  }
}
