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
    expect(typeof client.extend).toBe('function')
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

  it('should extend client defaults without mutating the parent', async () => {
    const configs: RequestConfig[] = []
    const adapter: Adapter = {
      async request<T = unknown>(
        config: RequestConfig
      ): Promise<NporaResponse<T>> {
        configs.push(config)

        return {
          data: config as T,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config,
          raw: new Response()
        }
      }
    }
    const parent = createClient({
      adapter,
      baseURL: 'https://api.example.com',
      headers: {
        Authorization: 'Bearer parent',
        'X-Parent': 'true'
      },
      query: {
        locale: 'en',
        page: 1
      },
      fetchOptions: {
        credentials: 'include'
      },
      extensions: {
        retry: {
          retries: 2,
          delay: 100
        }
      }
    })
    const child = parent.extend({
      baseURL: 'https://child.example.com',
      headers: {
        authorization: 'Bearer child',
        'X-Child': 'true'
      },
      query: {
        page: 2
      },
      fetchOptions: {
        cache: 'no-store'
      },
      extensions: {
        retry: {
          delay: 0
        }
      }
    })

    await child.get('/child')
    await parent.get('/parent')

    expect(configs[0]).toMatchObject({
      baseURL: 'https://child.example.com',
      query: {
        locale: 'en',
        page: 2
      },
      fetchOptions: {
        credentials: 'include',
        cache: 'no-store'
      },
      extensions: {
        retry: {
          retries: 2,
          delay: 0
        }
      }
    })
    expect(new Headers(configs[0]?.headers)).toEqual(
      new Headers({
        authorization: 'Bearer child',
        'x-parent': 'true',
        'x-child': 'true'
      })
    )
    expect(configs[1]).toMatchObject({
      baseURL: 'https://api.example.com',
      query: {
        locale: 'en',
        page: 1
      },
      fetchOptions: {
        credentials: 'include'
      },
      extensions: {
        retry: {
          retries: 2,
          delay: 100
        }
      }
    })
    expect(new Headers(configs[1]?.headers).get('authorization')).toBe(
      'Bearer parent'
    )
  })

  it('should allow an extended client to replace the adapter', async () => {
    const parentAdapter = createAdapter('parent')
    const childAdapter = createAdapter('child')
    const parent = createClient({
      adapter: parentAdapter
    })
    const child = parent.extend({
      adapter: childAdapter
    })

    await expect(parent.get('/source')).resolves.toEqual({
      source: 'parent'
    })
    await expect(child.get('/source')).resolves.toEqual({
      source: 'child'
    })
  })

  it('should keep interceptors and plugins isolated when extending', async () => {
    const parent = createClient()
    const requestInterceptor = vi.fn(config => config)

    parent.interceptors.request.use(requestInterceptor)
    parent.use({
      name: 'parent-only',
      install() {}
    })

    const child = parent.extend({
      adapter: createAdapter('child')
    })

    expect(child.hasPlugin('parent-only')).toBe(false)

    await child.get('/isolated')

    expect(requestInterceptor).not.toHaveBeenCalled()
  })
})

function createAdapter(source: string): Adapter {
  return {
    async request<T = unknown>(
      config: RequestConfig
    ): Promise<NporaResponse<T>> {
      return {
        data: {
          source
        } as T,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        config,
        raw: new Response()
      }
    }
  }
}
