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

    expect(response.data).toEqual({
      name: 'Npora'
    })

    expect(response.status).toBe(200)
  })

  it('should support json compatible content types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid request' }), {
          status: 200,
          headers: {
            'content-type': 'application/problem+json'
          }
        })
      )
    )

    const adapter = new FetchAdapter()

    const response = await adapter.request<{ message: string }>({
      url: 'https://api.example.com/problem'
    })

    expect(response.data).toEqual({
      message: 'Invalid request'
    })
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/error'
      })
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })
  })

  it('should throw PARSER_ERROR when json parsing fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('invalid-json', {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/invalid-json'
      })
    ).rejects.toMatchObject({
      name: 'RequestError',
      message: 'Failed to parse response',
      code: 'PARSER_ERROR',
      status: 200
    })
  })

  it('should return undefined for empty responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 204
        })
      )
    )

    const adapter = new FetchAdapter()

    const response = await adapter.request({
      url: 'https://api.example.com/empty'
    })

    expect(response.data).toBeUndefined()
  })

  it('should expose RequestError instances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/error'
      })
    ).rejects.toBeInstanceOf(RequestError)
  })
})
