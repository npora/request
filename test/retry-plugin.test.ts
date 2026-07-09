import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, retryPlugin } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('retryPlugin', () => {
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

    const request = createClient().use(retryPlugin())

    const data = await request.get<{ ok: boolean }>('/retry', {
      retry: {
        retries: 1,
        delay: 0
      }
    })

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

    const request = createClient().use(retryPlugin())

    await expect(
      request.get('/retry', {
        retry: 0
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should respect default retry options from plugin', async () => {
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

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0
      })
    )

    const data = await request.get<{ ok: boolean }>('/retry')

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
