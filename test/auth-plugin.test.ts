import { afterEach, describe, expect, it, vi } from 'vitest'
import { authPlugin, createClient } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authPlugin', () => {
  it('should add authorization header from request auth config', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(authPlugin())

    await request.get('/user', {
      auth: {
        token: 'token'
      }
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Bearer token')
  })

  it('should support custom auth scheme', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(authPlugin())

    await request.get('/user', {
      auth: {
        token: 'token',
        scheme: 'Token'
      }
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Token token')
  })

  it('should support async token provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(authPlugin())

    await request.get('/user', {
      auth: {
        token: async () => 'async-token'
      }
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Bearer async-token')
  })

  it('should use default auth options from plugin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        token: 'default-token'
      })
    )

    await request.get('/user')

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers

    expect(headers.get('authorization')).toBe('Bearer default-token')
  })
})
