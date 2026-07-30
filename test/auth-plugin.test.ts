import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('authPlugin refresh token', () => {
  it('should read request auth options from extensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(authPlugin())

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
