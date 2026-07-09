import type { Adapter, NporaResponse, RequestConfig } from '../types'

export type MockHandler<T = unknown> = (
  config: RequestConfig
) => T | Promise<T>

export interface MockAdapterOptions {
  handlers?: Record<string, MockHandler>
}

export class MockAdapter implements Adapter {
  private readonly handlers = new Map<string, MockHandler>()

  constructor(options: MockAdapterOptions = {}) {
    Object.entries(options.handlers ?? {}).forEach(([key, handler]) => {
      this.handlers.set(key, handler)
    })
  }

  on<T = unknown>(url: string, handler: MockHandler<T>): this {
    this.handlers.set(url, handler as MockHandler)

    return this
  }

  async request<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    const handler = this.handlers.get(config.url)

    if (!handler) {
      throw new Error(`No mock handler found for ${config.url}`)
    }

    const data = (await handler(config)) as T

    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      config,
      raw: new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    }
  }
}
