import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authPlugin,
  createClient,
  RequestError,
  type Adapter
} from '../src'

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

describe('authPlugin refresh token', () => {
  it('should pass bare authorization headers to custom adapters', async () => {
    let receivedHeaders: Headers | undefined
    const adapter: Adapter = {
      async request(config) {
        receivedHeaders = new Headers(config.headers)

        return {
          data: { ok: true },
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config,
          raw: new Response()
        }
      }
    }
    const request = createClient({ adapter }).use(
      authPlugin({
        token: 'bare-token'
      })
    )

    await request.get('/user')

    expect(receivedHeaders?.get('authorization')).toBe(
      'Bearer bare-token'
    )
  })

  it('should abort while the initial token provider is pending', async () => {
    const token = vi.fn(() => new Promise<string>(() => {}))
    const adapter: Adapter = {
      request: vi.fn(async config => ({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        config,
        raw: new Response()
      }))
    }
    const request = createClient({ adapter }).use(authPlugin({ token }))
    const controller = new AbortController()
    const pending = request.get('/pending-token', {
      signal: controller.signal
    }).catch(error => error)

    await vi.waitFor(() => {
      expect(token).toHaveBeenCalledTimes(1)
    })

    controller.abort('cancel initial token')

    const outcome = await Promise.race([
      pending,
      new Promise<'still-pending'>(resolve => {
        setTimeout(() => resolve('still-pending'), 25)
      })
    ])

    expect(outcome).toMatchObject({ code: 'ABORT_ERROR' })
    expect(adapter.request).not.toHaveBeenCalled()
  })

  it('should not start the initial token provider after synchronous abort registration', async () => {
    const reason = new Error('synchronous initial token abort')
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      reason: undefined as unknown,
      addEventListener(_type: string, listener: EventListener) {
        this.aborted = true
        this.reason = reason
        listener(new Event('abort'))
      },
      removeEventListener
    } as unknown as AbortSignal
    const token = vi.fn().mockResolvedValue('unused-token')
    const adapter: Adapter = {
      request: vi.fn()
    }
    const request = createClient({ adapter }).use(authPlugin({ token }))

    await expect(request.get('/sync-initial-token-abort', {
      signal
    })).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })
    expect(token).not.toHaveBeenCalled()
    expect(adapter.request).not.toHaveBeenCalled()
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('should prefer request auth options over a static plugin token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        token: 'plugin-token'
      })
    )

    await request.get('/user', {
      extensions: {
        auth: {
          token: 'extension-token',
          scheme: 'Token'
        }
      }
    })

    const headers = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    )

    expect(headers.get('authorization')).toBe(
      'Token extension-token'
    )
  })

  it('should refresh token after 401 and retry the request', async () => {
    let token = 'expired-token'

    const refreshToken = vi.fn(async () => {
      token = 'refreshed-token'

      return token
    })

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        const authorization = headers.get('authorization')

        if (authorization === 'Bearer expired-token') {
          return createJsonResponse(
            {
              message: 'Unauthorized'
            },
            401,
            'Unauthorized'
          )
        }

        return createJsonResponse({
          id: 1,
          name: 'Npora'
        })
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        token: () => token,
        refreshToken
      })
    )

    const data = await request.get<{
      id: number
      name: string
    }>('/user')

    expect(data).toEqual({
      id: 1,
      name: 'Npora'
    })

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstHeaders = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers
    )

    const secondHeaders = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers
    )

    expect(firstHeaders.get('authorization')).toBe(
      'Bearer expired-token'
    )

    expect(secondHeaders.get('authorization')).toBe(
      'Bearer refreshed-token'
    )
  })

  it('should preserve the original 401 error when refresh fails', async () => {
    const refreshError = new Error('refresh failed')

    const refreshToken = vi.fn().mockRejectedValue(refreshError)

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(
        {
          message: 'Unauthorized'
        },
        401,
        'Unauthorized'
      )
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        token: 'expired-token',
        refreshToken
      })
    )

    await expect(request.get('/user')).rejects.toMatchObject({
      name: 'RequestError',
      code: 'HTTP_ERROR',
      status: 401
    })

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should share one refresh operation across concurrent requests', async () => {
    let token = 'expired-token'

    const refreshToken = vi.fn(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 10)
      })

      token = 'refreshed-token'

      return token
    })

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        const authorization = headers.get('authorization')

        if (authorization === 'Bearer expired-token') {
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
        token: () => token,
        refreshToken
      })
    )

    const [first, second] = await Promise.all([
      request.get<{ ok: boolean }>('/user/1'),
      request.get<{ ok: boolean }>('/user/2')
    ])

    expect(first).toEqual({
      ok: true
    })

    expect(second).toEqual({
      ok: true
    })

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('should abort one refresh waiter without cancelling the shared refresh', async () => {
    let token = 'expired-token'
    let resolveRefresh!: (token: string) => void
    const refreshToken = vi.fn(() => {
      return new Promise<string>(resolve => {
        resolveRefresh = resolve
      })
    })
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const authorization = new Headers(init?.headers)
          .get('authorization')

        return authorization === 'Bearer expired-token'
          ? createJsonResponse({ unauthorized: true }, 401, 'Unauthorized')
          : createJsonResponse({ ok: true })
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(authPlugin({
      token: () => token,
      refreshToken
    }))
    const controller = new AbortController()
    const aborted = request.get('/aborted-refresh', {
      signal: controller.signal
    }).catch(error => error)
    const survivor = request.get('/surviving-refresh')

    await vi.waitFor(() => {
      expect(refreshToken).toHaveBeenCalledTimes(1)
    })

    controller.abort('cancel refresh waiter')

    const earlyOutcome = await Promise.race([
      aborted,
      new Promise<'still-pending'>(resolve => {
        setTimeout(() => resolve('still-pending'), 25)
      })
    ])

    token = 'refreshed-token'
    resolveRefresh(token)

    await expect(survivor).resolves.toEqual({ ok: true })
    await expect(aborted).resolves.toMatchObject({
      code: 'ABORT_ERROR'
    })
    expect(earlyOutcome).toMatchObject({ code: 'ABORT_ERROR' })
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('should not start refresh after synchronous abort registration', async () => {
    const reason = new Error('synchronous refresh abort')
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      reason: undefined as unknown,
      addEventListener(_type: string, listener: EventListener) {
        this.aborted = true
        this.reason = reason
        listener(new Event('abort'))
      },
      removeEventListener
    } as unknown as AbortSignal
    const adapter: Adapter = {
      async request(config) {
        throw new RequestError('Unauthorized', {
          code: 'HTTP_ERROR',
          status: 401,
          config
        })
      }
    }
    const refreshToken = vi.fn().mockResolvedValue('unused-token')
    const request = createClient({ adapter }).use(authPlugin({
      token: 'expired-token',
      refreshToken
    }))

    await expect(request.get('/sync-refresh-abort', {
      signal
    })).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })
    expect(refreshToken).not.toHaveBeenCalled()
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('should abort a refresh waiter when listener cleanup throws', async () => {
    let abortListener!: EventListener
    let aborted = false
    const reason = new Error('cancel refresh with broken cleanup')
    const signal = {
      get aborted() {
        return aborted
      },
      get reason() {
        return aborted ? reason : undefined
      },
      addEventListener(_type: string, listener: EventListener) {
        abortListener = listener
      },
      removeEventListener() {
        throw new Error('listener cleanup failed')
      }
    } as unknown as AbortSignal
    const adapter: Adapter = {
      async request(config) {
        throw new RequestError('Unauthorized', {
          code: 'HTTP_ERROR',
          status: 401,
          config
        })
      }
    }
    const refreshToken = vi.fn(() => new Promise<string>(() => {}))
    const request = createClient({ adapter }).use(authPlugin({
      token: 'expired-token',
      refreshToken
    }))
    const pending = request.get('/broken-refresh-cleanup', { signal })

    await vi.waitFor(() => {
      expect(refreshToken).toHaveBeenCalledTimes(1)
      expect(abortListener).toBeTypeOf('function')
    })

    aborted = true
    abortListener(new Event('abort'))

    await expect(pending).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })
  })

  it('should not retry an in-flight refresh after the plugin is removed', async () => {
    let resolveRefresh!: (token: string) => void
    let attempts = 0
    const adapter: Adapter = {
      async request(config) {
        attempts += 1

        if (attempts === 1) {
          throw new RequestError('Unauthorized', {
            code: 'HTTP_ERROR',
            status: 401,
            config
          })
        }

        return {
          data: { retried: true },
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config,
          raw: new Response()
        }
      }
    }
    const refreshToken = vi.fn(() => {
      return new Promise<string>(resolve => {
        resolveRefresh = resolve
      })
    })
    const request = createClient({ adapter }).use(authPlugin({
      token: 'expired-token',
      refreshToken
    }))
    const pending = request.get('/removed-during-refresh')

    await vi.waitFor(() => {
      expect(refreshToken).toHaveBeenCalledTimes(1)
    })

    request.unuse('auth')
    resolveRefresh('refreshed-token')

    await expect(pending).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 401
    })
    expect(attempts).toBe(1)
  })

  it('should abort while an asynchronous refresh policy is pending', async () => {
    const adapter: Adapter = {
      async request(config) {
        throw new RequestError('Unauthorized', {
          code: 'HTTP_ERROR',
          status: 401,
          config
        })
      }
    }
    const shouldRefresh = vi.fn(() => new Promise<boolean>(() => {}))
    const refreshToken = vi.fn().mockResolvedValue('unused-token')
    const request = createClient({ adapter }).use(authPlugin({
      token: 'expired-token',
      refreshToken,
      shouldRefresh
    }))
    const controller = new AbortController()
    const pending = request.get('/pending-refresh-policy', {
      signal: controller.signal
    }).catch(error => error)

    await vi.waitFor(() => {
      expect(shouldRefresh).toHaveBeenCalledTimes(1)
    })

    controller.abort('cancel refresh policy')

    const outcome = await Promise.race([
      pending,
      new Promise<'still-pending'>(resolve => {
        setTimeout(() => resolve('still-pending'), 25)
      })
    ])

    expect(outcome).toMatchObject({ code: 'ABORT_ERROR' })
    expect(refreshToken).not.toHaveBeenCalled()
  })

  it('should refresh and retry each request at most once', async () => {
    const refreshToken = vi.fn().mockResolvedValue(
      'refreshed-token'
    )

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(
        {
          message: 'Unauthorized'
        },
        401,
        'Unauthorized'
      )
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        token: 'expired-token',
        refreshToken
      })
    )

    await expect(request.get('/user')).rejects.toMatchObject({
      name: 'RequestError',
      code: 'HTTP_ERROR',
      status: 401
    })

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondHeaders = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers
    )

    expect(secondHeaders.get('authorization')).toBe(
      'Bearer refreshed-token'
    )
  })

  it('should preserve the request auth scheme after refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            message: 'Unauthorized'
          },
          401,
          'Unauthorized'
        )
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        refreshToken: async () => 'refreshed-token'
      })
    )

    await request.get('/user', {
      extensions: {
        auth: {
          token: 'expired-token',
          scheme: 'Token'
        }
      }
    })

    const retryHeaders = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers
    )

    expect(retryHeaders.get('authorization')).toBe(
      'Token refreshed-token'
    )
  })

  it('should re-read a request token provider after refresh', async () => {
    let token = 'expired-token'

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
        refreshToken() {
          token = 'refreshed-token'
        }
      })
    )

    await expect(
      request.get('/user', {
        extensions: {
          auth: {
            token: () => token
          }
        }
      })
    ).resolves.toEqual({
      ok: true
    })

    const retryHeaders = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers
    )

    expect(retryHeaders.get('authorization')).toBe(
      'Bearer refreshed-token'
    )
  })

  it('should use a returned refresh token without re-reading providers', async () => {
    const token = vi
      .fn()
      .mockReturnValueOnce('expired-token')
      .mockImplementation(() => {
        throw new Error('token provider should not run again')
      })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            message: 'Unauthorized'
          },
          401,
          'Unauthorized'
        )
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      authPlugin({
        refreshToken: async () => 'refreshed-token'
      })
    )

    await expect(
      request.get('/user', {
        extensions: {
          auth: {
            token
          }
        }
      })
    ).resolves.toEqual({
      ok: true
    })
    expect(token).toHaveBeenCalledTimes(1)
  })

  it('should recover on a later request after refresh fails', async () => {
    let token = 'expired-token'
    const refreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockImplementationOnce(() => {
        token = 'refreshed-token'
        return token
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
        token: () => token,
        refreshToken
      })
    )

    await expect(request.get('/first')).rejects.toMatchObject({
      status: 401
    })
    await expect(request.get('/second')).resolves.toEqual({
      ok: true
    })
    expect(refreshToken).toHaveBeenCalledTimes(2)
  })
})
