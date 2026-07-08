import { describe, expect, it, vi } from 'vitest'
import type { Plugin } from '../src'
import { createClient, RequestError } from '../src'

describe('plugin', () => {
  it('should run beforeRequest lifecycle', async () => {
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

    const authPlugin: Plugin = {
      name: 'auth',

      beforeRequest(context) {
        context.config.headers = {
          ...context.config.headers,
          authorization: 'Bearer token'
        }
      }
    }

    request.use(authPlugin)

    await request.get('/user')

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Bearer token')

    vi.unstubAllGlobals()
  })

  it('should run afterResponse lifecycle', async () => {
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

    const plugin: Plugin = {
      name: 'response-transform',

      afterResponse(context) {
        context.response!.data = {
          ...(context.response!.data as object),
          plugin: true
        }
      }
    }

    request.use(plugin)

    const data = await request.get<{ name: string; plugin: boolean }>('/user')

    expect(data).toEqual({
      name: 'Npora',
      plugin: true
    })

    vi.unstubAllGlobals()
  })

  it('should run onError lifecycle', async () => {
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

    const plugin: Plugin = {
      name: 'error-transform',

      onError(context) {
        if (context.error instanceof RequestError) {
          context.error = new RequestError('Plugin error message', {
            code: context.error.code,
            status: context.error.status,
            cause: context.error
          })
        }
      }
    }

    request.use(plugin)

    await expect(request.get('/not-found')).rejects.toMatchObject({
      message: 'Plugin error message',
      code: 'HTTP_ERROR',
      status: 404
    })

    vi.unstubAllGlobals()
  })

  it('should setup plugin only once', () => {
    const request = createClient()
    const setup = vi.fn()

    const plugin: Plugin = {
      name: 'once',
      setup
    }

    request.use(plugin)
    request.use(plugin)

    expect(setup).toHaveBeenCalledTimes(1)
  })

  it('should support chaining', () => {
    const request = createClient()

    const plugin: Plugin = {
      name: 'chain'
    }

    expect(request.use(plugin)).toBe(request)
  })
})
