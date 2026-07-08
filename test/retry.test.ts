import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../src'

describe('retry', () => {
  it('should retry when request fails with 500', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Server Error' }), {
          status: 500,
          statusText: 'Server Error',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      retry: {
        retries: 1,
        delay: 0
      }
    })

    const data = await request.get<{ ok: boolean }>('/retry')

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })

  it('should not retry when retries is 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Server Error' }), {
        status: 500,
        statusText: 'Server Error',
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      retry: 0
    })

    await expect(request.get('/retry')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  it('should respect custom shouldRetry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Bad Request' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      retry: {
        retries: 1,
        delay: 0,
        shouldRetry(error) {
          return (
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            error.status === 400
          )
        }
      }
    })

    const data = await request.get<{ ok: boolean }>('/retry')

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })

  it('should retry network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      retry: {
        retries: 1,
        delay: 0
      }
    })

    const data = await request.get<{ ok: boolean }>('/retry')

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })
})
