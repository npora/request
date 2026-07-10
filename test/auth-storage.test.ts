import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthTokenStorage } from '../src'
import { authPlugin, createClient } from '../src'

function createJsonResponse(
  data: unknown,
  status = 200,
  statusText = 'OK'
): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: {
      'content-type': 'application/json'
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('authPlugin token storage', () => {
  it('should read the access token from storage', async () => {
    const storage: AuthTokenStorage = {
      get: vi.fn().mockResolvedValue('stored-token'),
      set: vi.fn(),
      remove: vi.fn()
    }

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        storage
      })
    )

    await request.get('/user')

    const headers = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    )

    expect(storage.get).toHaveBeenCalledTimes(1)

    expect(headers.get('authorization')).toBe(
      'Bearer stored-token'
    )
  })

  it('should prefer the configured token over storage', async () => {
    const storage: AuthTokenStorage = {
      get: vi.fn().mockResolvedValue('stored-token'),
      set: vi.fn(),
      remove: vi.fn()
    }

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        token: 'configured-token',
        storage
      })
    )

    await request.get('/user')

    const headers = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    )

    expect(storage.get).not.toHaveBeenCalled()

    expect(headers.get('authorization')).toBe(
      'Bearer configured-token'
    )
  })

  it('should store the refreshed access token', async () => {
    let storedToken = 'expired-token'

    const storage: AuthTokenStorage = {
      get: vi.fn(() => storedToken),

      set: vi.fn(token => {
        storedToken = token
      }),

      remove: vi.fn(() => {
        storedToken = ''
      })
    }

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)

        if (
          headers.get('authorization') ===
          'Bearer expired-token'
        ) {
          return createJsonResponse(
            {
              message: 'Unauthorized'
            },
            401,
            'Unauthorized'
          )
        }

        return createJsonResponse({
          ok: true
        })
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        storage,
        refreshToken: async () => 'refreshed-token'
      })
    )

    const data = await request.get<{ ok: boolean }>('/user')

    expect(data).toEqual({
      ok: true
    })

    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledWith('refreshed-token')
    expect(storedToken).toBe('refreshed-token')
  })

  it('should not write storage when refresh returns void', async () => {
    let storedToken = 'expired-token'

    const storage: AuthTokenStorage = {
      get: vi.fn(() => storedToken),

      set: vi.fn(token => {
        storedToken = token
      }),

      remove: vi.fn()
    }

    const refreshToken = vi.fn(() => {
      storedToken = 'externally-updated-token'
    })

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)

        if (
          headers.get('authorization') ===
          'Bearer expired-token'
        ) {
          return createJsonResponse(
            {
              message: 'Unauthorized'
            },
            401,
            'Unauthorized'
          )
        }

        return createJsonResponse({
          ok: true
        })
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        storage,
        refreshToken
      })
    )

    const data = await request.get<{ ok: boolean }>('/user')

    expect(data).toEqual({
      ok: true
    })

    expect(storage.set).not.toHaveBeenCalled()
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('should support removing a stored token', async () => {
    const storage: AuthTokenStorage = {
      get: vi.fn().mockResolvedValue('stored-token'),
      set: vi.fn(),
      remove: vi.fn()
    }

    await storage.remove()

    expect(storage.remove).toHaveBeenCalledTimes(1)
  })
})
