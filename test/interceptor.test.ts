import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, RequestError } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('interceptors', () => {
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
})
