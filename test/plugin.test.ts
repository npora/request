import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from '../src'
import { createClient } from '../src'

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

    const authPlugin: Plugin = {
      name: 'auth',

      install(client) {
        client.interceptors.request.use(config => {
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

    request.use(authPlugin)

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
})
