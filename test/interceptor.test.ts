import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  InterceptorManager,
  RequestError
} from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('interceptors', () => {
  it('should track whether the optimized interceptor path is active', () => {
    const interceptors = new InterceptorManager<number>()

    expect(interceptors.active).toBe(false)

    const first = interceptors.use(value => value + 1)

    expect(interceptors.active).toBe(true)

    interceptors.eject(first)

    expect(interceptors.active).toBe(false)

    interceptors.use(value => value + 1)
    interceptors.clear()

    expect(interceptors.active).toBe(false)
  })

  it('should run request interceptor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    request.interceptors.request.use(config => {
      return {
        ...config,
        headers: {
          ...config.headers,
          authorization: 'Bearer token'
        }
      }
    })

    await request.get('/user')

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Bearer token')
  })

  it('should run response interceptor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: 'Npora' }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const request = createClient()

    request.interceptors.response.use(response => {
      return {
        ...response,
        data: {
          ...(response.data as object),
          intercepted: true
        }
      }
    })

    const data = await request.get<{ name: string; intercepted: boolean }>(
      '/user'
    )

    expect(data).toEqual({
      name: 'Npora',
      intercepted: true
    })
  })

  it('should run error interceptor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const request = createClient()

    request.interceptors.error.use(error => {
      if (error instanceof RequestError) {
        return new RequestError('Custom error message', {
          code: error.code,
          status: error.status,
          cause: error
        })
      }

      return error
    })

    await expect(request.get('/not-found')).rejects.toMatchObject({
      message: 'Custom error message',
      code: 'HTTP_ERROR',
      status: 404
    })
  })

  it('should eject interceptor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    const id = request.interceptors.request.use(config => {
      return {
        ...config,
        headers: {
          ...config.headers,
          authorization: 'Bearer token'
        }
      }
    })

    request.interceptors.request.eject(id)

    await request.get('/user')

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe(null)
  })

  it('should run higher priority interceptors first and preserve ties', async () => {
    const order: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const request = createClient()

    request.interceptors.request.use(
      config => {
        order.push('normal-first')
        return config
      },
      {
        priority: 0
      }
    )

    request.interceptors.request.use(
      config => {
        order.push('high-first')
        return config
      },
      {
        priority: 10
      }
    )

    request.interceptors.request.use(
      config => {
        order.push('high-second')
        return config
      },
      {
        priority: 10
      }
    )

    await request.get('/priority')

    expect(order).toEqual([
      'high-first',
      'high-second',
      'normal-first'
    ])
  })

  it('should preserve mixed synchronous and asynchronous interceptor order', async () => {
    const interceptors = new InterceptorManager<number>()
    const order: string[] = []

    interceptors.use(value => {
      order.push('sync-first')
      return value + 1
    })
    interceptors.use(async value => {
      await Promise.resolve()
      order.push('async')
      return value * 2
    })
    interceptors.use(value => {
      order.push('sync-last')
      return value + 3
    })

    await expect(interceptors.run(1)).resolves.toBe(7)
    expect(order).toEqual([
      'sync-first',
      'async',
      'sync-last'
    ])
  })
})
