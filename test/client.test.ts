import { describe, expect, it, vi } from 'vitest'
import type {
  Adapter,
  NporaResponse,
  RequestConfig
} from '../src'
import { createClient } from '../src'

describe('client', () => {
  it('should create client instance', () => {
    const client = createClient()

    expect(client).toBeDefined()
    expect(typeof client.request).toBe('function')
    expect(typeof client.get).toBe('function')
    expect(typeof client.post).toBe('function')
    expect(typeof client.put).toBe('function')
    expect(typeof client.patch).toBe('function')
    expect(typeof client.delete).toBe('function')
  })

  it('should use custom adapter', async () => {
    const adapter: Adapter = {
      async request<T = unknown>(
        config: RequestConfig
      ): Promise<NporaResponse<T>> {
        return {
          data: {
            source: 'custom-adapter'
          } as T,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config,
          raw: new Response()
        }
      }
    }

    const requestSpy = vi.spyOn(adapter, 'request')

    const client = createClient({
      adapter,
      baseURL: 'https://api.example.com'
    })

    const data = await client.get<{ source: string }>('/user')

    expect(data).toEqual({
      source: 'custom-adapter'
    })

    expect(requestSpy).toHaveBeenCalledTimes(1)

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.example.com',
        url: '/user',
        method: 'GET'
      })
    )
  })
})
