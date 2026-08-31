import { describe, expect, it, vi } from 'vitest'
import type {
  Adapter,
  NporaResponse,
  RequestConfig
} from '../src'
import { createClient } from '../src'
import { ConfigMerger } from '../src/core/ConfigMerger'

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
    expect(typeof client.head).toBe('function')
    expect(typeof client.headResponse).toBe('function')
    expect(typeof client.options).toBe('function')
    expect(typeof client.optionsResponse).toBe('function')
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

  it('should bypass config merging for bare method shortcuts', async () => {
    const merge = vi.spyOn(ConfigMerger, 'merge')
    const client = createClient({
      adapter: createAdapter('bare')
    })

    await expect(client.get('/bare')).resolves.toEqual({
      source: 'bare'
    })
    await expect(client.getResponse('/bare-response')).resolves.toMatchObject({
      data: { source: 'bare' }
    })
    expect(merge).not.toHaveBeenCalled()

    await expect(client.get('/configured', {
      responseType: 'text'
    })).resolves.toEqual({ source: 'bare' })
    expect(merge).toHaveBeenCalledTimes(1)
    merge.mockRestore()
  })

  it('should reject synchronous adapter failures through the Promise API', async () => {
    const client = createClient({
      adapter: {
        request(): Promise<NporaResponse> {
          throw new Error('synchronous adapter failure')
        }
      }
    })

    const result = client.get('/user')

    await expect(result).rejects.toThrow(
      'synchronous adapter failure'
    )
  })

  it('should reject method configuration merge failures through the Promise API', async () => {
    const invalidConfig = new Proxy({}, {
      ownKeys() {
        throw new Error('configuration merge failure')
      }
    })
    const client = createClient({
      adapter: createAdapter('unused')
    })

    await expect(
      client.get('/user', invalidConfig)
    ).rejects.toThrow('configuration merge failure')
    await expect(
      client.getResponse('/user', invalidConfig)
    ).rejects.toThrow('configuration merge failure')
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

  it('should preserve overridden request dispatch for method shortcuts', async () => {
    const client = createClient({
      adapter: createAdapter('shortcut')
    })
    const requestSpy = vi.spyOn(client, 'request')
    const responseSpy = vi.spyOn(client, 'requestResponse')

    await client.get('/data')
    await client.getResponse('/response')

    expect(requestSpy).toHaveBeenCalledWith({
      url: '/data',
      method: 'GET'
    })
    expect(responseSpy).toHaveBeenCalledWith({
      url: '/response',
      method: 'GET'
    })
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

  it('should send HEAD, OPTIONS, and QUERY requests', async () => {
    const methods: Array<RequestConfig['method']> = []
    const adapter: Adapter = {
      async request<T = unknown>(
        config: RequestConfig
      ): Promise<NporaResponse<T>> {
        methods.push(config.method)

        return {
          data: (
            config.method === 'HEAD'
              ? undefined
              : {
                  allowed: true
                }
          ) as T,
          status: 200,
          statusText: 'OK',
          headers: new Headers({
            allow: 'GET, HEAD, OPTIONS, QUERY'
          }),
          config,
          raw: new Response()
        }
      }
    }
    const client = createClient({ adapter })

    await expect(client.head('/resource')).resolves.toBeUndefined()
    await expect(
      client.headResponse('/resource')
    ).resolves.toMatchObject({
      status: 200,
      data: undefined
    })
    await expect(
      client.options<{ allowed: boolean }>('/resource')
    ).resolves.toEqual({
      allowed: true
    })
    await expect(
      client.optionsResponse<{ allowed: boolean }>('/resource')
    ).resolves.toMatchObject({
      status: 200,
      data: {
        allowed: true
      }
    })
    await expect(
      client.query<{ allowed: boolean }>('/resource', {
        json: { filter: 'active' }
      })
    ).resolves.toEqual({
      allowed: true
    })
    await expect(
      client.queryResponse<{ allowed: boolean }>('/resource', {
        json: { filter: 'active' }
      })
    ).resolves.toMatchObject({
      status: 200,
      data: {
        allowed: true
      }
    })

    expect(methods).toEqual([
      'HEAD',
      'HEAD',
      'OPTIONS',
      'OPTIONS',
      'QUERY',
      'QUERY'
    ])
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
