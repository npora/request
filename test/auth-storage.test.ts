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
  it.each([
    { reinstall: false, oldCompletesLast: false },
    { reinstall: true, oldCompletesLast: false },
    { reinstall: true, oldCompletesLast: true }
  ])('should ignore a removed refresh with $reinstall reinstall and $oldCompletesLast late completion', async ({ reinstall, oldCompletesLast }) => {
    let storedToken: string | undefined = 'expired-token'
    const storage: AuthTokenStorage = {
      get: () => storedToken,
      set: vi.fn(token => { storedToken = token }),
      remove: () => { storedToken = undefined }
    }
    const resolvers: Array<(token: string) => void> = []
    const refreshToken = vi.fn(() => new Promise<string>(resolve => {
      resolvers.push(resolve)
    }))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Headers(init?.headers).get('authorization') === 'Bearer current-token'
        ? createJsonResponse({ ok: true })
        : createJsonResponse({}, 401)
    })
    const shouldRefresh = vi.fn(() => true)
    const plugin = authPlugin({ storage, refreshToken, shouldRefresh })
    const request = createClient({ fetch: fetchMock }).use(plugin)
    const oldRequest = request.get('/old').catch(error => error)
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1))

    request.unuse('auth')
    await storage.remove()
    let currentRequest: Promise<unknown> | undefined
    if (reinstall) {
      request.use(plugin)
      currentRequest = request.get('/current')
      await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(2))
    }

    if (oldCompletesLast) {
      resolvers[1]!('current-token')
      await expect(currentRequest).resolves.toEqual({ ok: true })
    }

    resolvers[0]!('stale-token')
    expect(await oldRequest).toMatchObject({ code: 'HTTP_ERROR', status: 401 })
    if (oldCompletesLast) {
      expect(storage.set).toHaveBeenCalledExactlyOnceWith('current-token')
      expect(storedToken).toBe('current-token')
    } else {
      expect(storage.set).not.toHaveBeenCalled()
      expect(storedToken).toBeUndefined()
    }

    if (currentRequest && !oldCompletesLast) {
      // A late old completion must not clear the new single-flight refresh.
      const follower = request.get('/follower')
      await vi.waitFor(() => expect(shouldRefresh).toHaveBeenCalledTimes(3))
      resolvers[1]!('current-token')
      await expect(currentRequest).resolves.toEqual({ ok: true })
      await expect(follower).resolves.toEqual({ ok: true })
      expect(refreshToken).toHaveBeenCalledTimes(2)
      expect(storage.set).toHaveBeenCalledExactlyOnceWith('current-token')
    }
  })

  it('should preserve a shared refresh for another active installation', async () => {
    const storage: AuthTokenStorage = {
      get: () => 'expired-token',
      set: vi.fn(),
      remove: vi.fn()
    }
    let resolveRefresh!: (token: string) => void
    const refreshToken = vi.fn(() => new Promise<string>(resolve => {
      resolveRefresh = resolve
    }))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Headers(init?.headers).get('authorization') === 'Bearer shared-token'
        ? createJsonResponse({ ok: true })
        : createJsonResponse({}, 401)
    })
    const plugin = authPlugin({ storage, refreshToken })
    const first = createClient({ fetch: fetchMock }).use(plugin)
    const second = createClient({ fetch: fetchMock }).use(plugin)
    const removed = first.get('/first').catch(error => error)
    const retained = second.get('/second')
    // Both 401 lifecycles must have joined the shared refresh before removal.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(refreshToken).toHaveBeenCalledTimes(1)
    })
    first.unuse('auth')
    resolveRefresh('shared-token')
    expect(await removed).toMatchObject({ status: 401 })
    await expect(retained).resolves.toEqual({ ok: true })
    expect(storage.set).toHaveBeenCalledExactlyOnceWith('shared-token')
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

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

  it('should persist a shared concurrent refresh only once', async () => {
    let storedToken = 'expired-token'
    const storage: AuthTokenStorage = {
      get: vi.fn(() => storedToken),
      set: vi.fn(token => {
        storedToken = token
      }),
      remove: vi.fn()
    }
    const refreshToken = vi.fn(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 10)
      })

      return 'refreshed-token'
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

    await Promise.all([
      request.get('/first'),
      request.get('/second')
    ])

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledWith('refreshed-token')
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
