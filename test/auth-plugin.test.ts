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
})
