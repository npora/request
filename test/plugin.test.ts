import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from '../src'
import {
  createClient,
  PluginError
} from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin', () => {
  it('should install plugin', async () => {
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

    const plugin: Plugin = {
      name: 'auth',

      install(context) {
        context.interceptors.request.use(config => {
          return {
            ...config,
            headers: {
              ...config.headers,
              authorization: 'Bearer token'
            }
          }
        })
      }
    }

    request.use(plugin)

    await request.get('/user')

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Bearer token')
  })

  it('should install plugin only once', () => {
    const request = createClient()
    const install = vi.fn()

    const plugin: Plugin = {
      name: 'once',
      install
    }

    request.use(plugin)
    request.use(plugin)

    expect(install).toHaveBeenCalledTimes(1)
  })

  it('should support chaining', () => {
    const request = createClient()

    const plugin: Plugin = {
      name: 'chain',
      install() {}
    }

    expect(request.use(plugin)).toBe(request)
  })

  it('should expose installed plugin state', () => {
    const request = createClient()
    const plugin: Plugin = {
      name: 'state',
      install() {}
    }

    expect(request.hasPlugin('state')).toBe(false)

    request.use(plugin)

    expect(request.hasPlugin('state')).toBe(true)

    request.unuse('state')

    expect(request.hasPlugin('state')).toBe(false)
  })

  it('should run higher priority plugin registrations first', async () => {
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

    const low: Plugin = {
      name: 'low',
      priority: 0,
      install({ hooks }) {
        hooks.onRequest(() => {
          order.push('low')
        })
      }
    }

    const high: Plugin = {
      name: 'high',
      priority: 10,
      install({ hooks }) {
        hooks.onRequest(() => {
          order.push('high')
        })
      }
    }

    const request = createClient()
      .use(low)
      .use(high)

    await request.get('/priority')

    expect(order).toEqual([
      'high',
      'low'
    ])
  })

  it('should process responses supplied by request hooks', async () => {
    const responseHook = vi.fn()
    const responseInterceptor = vi.fn(response => {
      return {
        ...response,
        data: {
          ...(response.data as object),
          intercepted: true
        }
      }
    })
    const fetchMock = vi.fn()
    const plugin: Plugin = {
      name: 'short-circuit',
      install({ hooks }) {
        hooks.onRequest(context => {
          context.response = {
            data: {
              source: 'plugin'
            },
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            config: context.config,
            raw: new Response()
          }
        })
        hooks.onResponse(responseHook)
      }
    }
    const request = createClient().use(plugin)

    vi.stubGlobal('fetch', fetchMock)
    request.interceptors.response.use(responseInterceptor)

    await expect(request.get('/short-circuit')).resolves.toEqual({
      source: 'plugin',
      intercepted: true
    })
    expect(responseHook).toHaveBeenCalledTimes(1)
    expect(responseInterceptor).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should require dependencies to be installed first', () => {
    const request = createClient()
    const plugin: Plugin = {
      name: 'metrics',
      requires: ['logger'],
      install() {}
    }

    expect(() => {
      request.use(plugin)
    }).toThrowError(
      expect.objectContaining({
        name: 'PluginError',
        code: 'MISSING_DEPENDENCY',
        plugin: 'metrics',
        relatedPlugin: 'logger'
      })
    )

    expect(request.hasPlugin('metrics')).toBe(false)
  })

  it('should detect plugin conflicts in either direction', () => {
    const request = createClient()
    const first: Plugin = {
      name: 'first',
      conflicts: ['second'],
      install() {}
    }
    const second: Plugin = {
      name: 'second',
      install() {}
    }

    request.use(first)

    expect(() => {
      request.use(second)
    }).toThrowError(
      expect.objectContaining({
        name: 'PluginError',
        code: 'PLUGIN_CONFLICT',
        plugin: 'second',
        relatedPlugin: 'first'
      })
    )
  })

  it('should prevent removal while another plugin depends on it', () => {
    const request = createClient()
    const base: Plugin = {
      name: 'base',
      install() {}
    }
    const dependent: Plugin = {
      name: 'dependent',
      requires: ['base'],
      install() {}
    }

    request.use(base).use(dependent)

    expect(() => {
      request.unuse('base')
    }).toThrowError(
      expect.objectContaining({
        name: 'PluginError',
        code: 'DEPENDENCY_IN_USE',
        plugin: 'base',
        relatedPlugin: 'dependent'
      })
    )

    expect(request.hasPlugin('base')).toBe(true)
  })

  it('should automatically clean plugin interceptors, hooks and resources', async () => {
    const cleanup = vi.fn()
    const hook = vi.fn()
    const settledHook = vi.fn()
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    })

    vi.stubGlobal('fetch', fetchMock)

    const plugin: Plugin = {
      name: 'scoped',
      install({ interceptors, hooks }) {
        interceptors.request.use(config => {
          return {
            ...config,
            headers: {
              ...config.headers,
              'x-plugin': 'installed'
            }
          }
        })

        hooks.onRequest(hook)
        hooks.onSettled(settledHook)

        return cleanup
      }
    }

    const request = createClient().use(plugin)

    await request.get('/before')
    request.unuse('scoped')
    await request.get('/after')

    const beforeHeaders = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    )
    const afterHeaders = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers
    )

    expect(beforeHeaders.get('x-plugin')).toBe('installed')
    expect(afterHeaders.get('x-plugin')).toBe(null)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(settledHook).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('should isolate settled hooks and expose the final outcome', async () => {
    const settled = vi.fn()
    const broken: Plugin = {
      name: 'broken-settled',
      priority: 10,
      install({ hooks }) {
        hooks.onSettled(() => {
          throw new Error('settled observer failed')
        })
      }
    }
    const observer: Plugin = {
      name: 'settled-observer',
      install({ hooks }) {
        hooks.onSettled(context => {
          settled({
            response: context.response?.data,
            error: context.error,
            startTime: context.startTime,
            endTime: context.endTime
          })
        })
      }
    }

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
      .use(broken)
      .use(observer)

    await expect(request.get('/settled')).resolves.toEqual({
      ok: true
    })
    expect(settled).toHaveBeenCalledWith({
      response: {
        ok: true
      },
      error: undefined,
      startTime: expect.any(Number),
      endTime: expect.any(Number)
    })
  })

  it('should rollback scoped registrations when installation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const plugin: Plugin = {
      name: 'broken',
      install({ interceptors }) {
        interceptors.request.use(config => {
          return {
            ...config,
            headers: {
              ...config.headers,
              'x-broken': 'true'
            }
          }
        })

        throw new Error('install failed')
      }
    }

    const request = createClient()

    expect(() => {
      request.use(plugin)
    }).toThrow('install failed')

    await request.get('/after-failure')

    const headers = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    )

    expect(headers.get('x-broken')).toBe(null)
    expect(request.hasPlugin('broken')).toBe(false)
  })

  it('should expose PluginError instances', () => {
    const error = new PluginError('Missing dependency', {
      code: 'MISSING_DEPENDENCY',
      plugin: 'metrics',
      relatedPlugin: 'logger'
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(PluginError)
  })
})
