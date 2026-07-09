import { afterEach, describe, expect, it, vi } from 'vitest'
import { FetchAdapter, RequestError } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FetchAdapter', () => {
  it('should request json response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: 'Npora' }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const adapter = new FetchAdapter()

    const response = await adapter.request<{ name: string }>({
      url: 'https://api.example.com/user'
    })

    expect(response.data).toEqual({ name: 'Npora' })
    expect(response.status).toBe(200)
  })

  it('should throw HTTP_ERROR when status is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/not-found'
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404
    })
  })

  it('should throw NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/error'
      })
    ).rejects.toBeInstanceOf(RequestError)
  })
})
