export type Interceptor<T> = (value: T) => T | Promise<T>

export class InterceptorManager<T> {
  private id = 0

  private readonly interceptors = new Map<number, Interceptor<T>>()

  use(interceptor: Interceptor<T>): number {
    const id = this.id++

    this.interceptors.set(id, interceptor)

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

    for (const interceptor of this.interceptors.values()) {
      result = await interceptor(result)
    }

    return result
  }
}
