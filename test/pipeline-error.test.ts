import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from '../src'
import { createClient } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pipeline error lifecycle', () => {
  it('should route request interceptor errors through error handlers', async () => {
    const events: string[] = []
    const fetchMock = vi.fn()
    const request = createClient().use(
      errorObserverPlugin(events)
    )

    vi.stubGlobal('fetch', fetchMock)

    request.interceptors.request.use(() => {
      throw new Error('request interceptor failed')
    })
    request.interceptors.error.use(error => {
      events.push('error-interceptor')

      return new Error(
        `handled: ${(error as Error).message}`
      )
    })

    await expect(request.get('/user')).rejects.toThrow(
      'handled: request interceptor failed'
    )
    expect(events).toEqual([
      'plugin-error',
      'error-interceptor'
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should route request hook errors through error handlers', async () => {
    const errorInterceptor = vi.fn(error => error)
    const fetchMock = vi.fn()
    const plugin: Plugin = {
      name: 'request-failure',
      install({ hooks }) {
        hooks.onRequest(() => {
          throw new Error('request hook failed')
        })
      }
    }
    const request = createClient().use(plugin)

    vi.stubGlobal('fetch', fetchMock)
    request.interceptors.error.use(errorInterceptor)

    await expect(request.get('/user')).rejects.toThrow(
      'request hook failed'
    )
    expect(errorInterceptor).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'request hook failed'
      })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should pass an error hook failure to the error interceptor', async () => {
    const errorInterceptor = vi.fn(error => {
      return new Error(
        `handled: ${(error as Error).message}`
      )
    })
    const plugin: Plugin = {
      name: 'broken-error-hook',
      install({ hooks }) {
        hooks.onError(() => {
          throw new Error('error hook failed')
        })
      }
    }
    const request = createClient().use(plugin)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network failed'))
    )
    request.interceptors.error.use(errorInterceptor)

    await expect(request.get('/user')).rejects.toThrow(
      'handled: error hook failed'
    )
    expect(errorInterceptor).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'error hook failed'
      })
    )
  })

  it('should route retry hook failures through the error lifecycle', async () => {
    const observedErrors: string[] = []
    const errorInterceptor = vi.fn(error => error)
    const plugin: Plugin = {
      name: 'broken-retry-hook',
      install({ hooks }) {
        hooks.onError(context => {
          observedErrors.push(
            (context.error as Error).message
          )
        })
        hooks.onRetry(() => {
          throw new Error('retry hook failed')
        })
      }
    }
    const request = createClient().use(plugin)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network failed'))
    )
    request.interceptors.error.use(errorInterceptor)

    await expect(request.get('/user')).rejects.toThrow(
      'retry hook failed'
    )
    expect(observedErrors).toEqual([
      'Network request failed',
      'retry hook failed'
    ])
    expect(errorInterceptor).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'retry hook failed'
      })
    )
  })

  it('should handle response errors from a short-circuited request', async () => {
    const observedErrors: string[] = []
    const plugin: Plugin = {
      name: 'short-circuit-error',
      install({ hooks }) {
        hooks.onRequest(context => {
          context.response = {
            data: {
              cached: true
            },
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            config: context.config,
            raw: new Response()
          }
        })
        hooks.onError(context => {
          observedErrors.push(
            (context.error as Error).message
          )
        })
      }
    }
    const request = createClient().use(plugin)

    request.interceptors.response.use(() => {
      throw new Error('response transform failed')
    })
    request.interceptors.error.use(error => {
      return new Error(
        `handled: ${(error as Error).message}`
      )
    })

    await expect(request.get('/cached')).rejects.toThrow(
      'handled: response transform failed'
    )
    expect(observedErrors).toEqual([
      'response transform failed'
    ])
  })
})

function errorObserverPlugin(events: string[]): Plugin {
  return {
    name: 'error-observer',
    install({ hooks }) {
      hooks.onError(() => {
        events.push('plugin-error')
      })
    }
  }
}
