import { describe, expect, it, vi } from 'vitest'
import { FetchAdapter, RequestContext, RequestError } from '../src'

describe('FetchAdapter', () => {
  it('should parse json response by default', async () => {
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
    const context = new RequestContext<{ name: string }>({
      url: 'https://api.example.com/user'
    })

    await adapter.request(context)

    expect(context.error).toBeUndefined()
    expect(context.response?.data).toEqual({ name: 'Npora' })

    vi.unstubAllGlobals()
  })

  it('should parse text response when responseType is text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('hello npora', {
          status: 200,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    const adapter = new FetchAdapter()
    const context = new RequestContext<string>({
      url: 'https://api.example.com/text',
      responseType: 'text'
    })

    await adapter.request(context)

    expect(context.error).toBeUndefined()
    expect(context.response?.data).toBe('hello npora')

    vi.unstubAllGlobals()
  })

  it('should set HTTP_ERROR when status is not valid', async () => {
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
    const context = new RequestContext({
      url: 'https://api.example.com/not-found'
    })

    await adapter.request(context)

    expect(context.error).toBeInstanceOf(RequestError)
    expect(context.error?.code).toBe('HTTP_ERROR')
    expect(context.error?.status).toBe(404)

    vi.unstubAllGlobals()
  })

  it('should respect custom validateStatus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Accepted' }), {
          status: 404,
          statusText: 'Not Found',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const adapter = new FetchAdapter()
    const context = new RequestContext({
      url: 'https://api.example.com/not-found',
      validateStatus: status => status === 404
    })

    await adapter.request(context)

    expect(context.error).toBeUndefined()
    expect(context.response?.status).toBe(404)
    expect(context.response?.data).toEqual({ message: 'Accepted' })

    vi.unstubAllGlobals()
  })

  it('should set NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const adapter = new FetchAdapter()
    const context = new RequestContext({
      url: 'https://api.example.com/error'
    })

    await adapter.request(context)

    expect(context.error).toBeInstanceOf(RequestError)
    expect(context.error?.code).toBe('NETWORK_ERROR')

    vi.unstubAllGlobals()
  })
})
