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
    expect(typeof client.requestResponse).toBe('function')
    expect(typeof client.get).toBe('function')
    expect(typeof client.getResponse).toBe('function')
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

  it('should expose the complete response when requested', async () => {
    const adapter: Adapter = {
      async request<T = unknown>(
        config: RequestConfig
      ): Promise<NporaResponse<T>> {
        return {
          data: { name: 'Npora' } as T,
          status: 201,
          statusText: 'Created',
          headers: new Headers({
            'x-request-id': 'request-1'
          }),
          config,
          raw: new Response()
        }
      }
    }

    const client = createClient({ adapter })
    const response = await client.getResponse<{ name: string }>('/user')

    expect(response.data).toEqual({ name: 'Npora' })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBe('request-1')
  })
})
