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

  it('should normalize media types before detecting json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid request' }), {
          status: 200,
          headers: {
            'content-type': 'Application/Problem+JSON; Charset=UTF-8'
          }
        })
      )
    )

    const response = await new FetchAdapter().request<{
      message: string
    }>({
      url: 'https://api.example.com/problem'
    })

    expect(response.data).toEqual({
      message: 'Invalid request'
    })
  })

  it('should not detect json from a malformed media type substring', async () => {
    const source = JSON.stringify({ trusted: false })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(source, {
          status: 200,
          headers: {
            'content-type': 'application/json-malformed'
          }
        })
      )
    )

    const response = await new FetchAdapter().request<string>({
      url: 'https://api.example.com/untrusted'
    })

    expect(response.data).toBe(source)
  })

  it('should default responses without a content type to text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new TextEncoder().encode('plain response'))
      )
    )

    const response = await new FetchAdapter().request<string>({
      url: 'https://api.example.com/plain'
    })

    expect(response.data).toBe('plain response')
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

    const config = {
      url: 'https://api.example.com/not-found'
    }

    await expect(
      adapter.request<{ message: string }>({
        url: 'https://api.example.com/not-found'
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404,
      data: {
        message: 'Not Found'
      },
      config,
      response: {
        status: 404,
        data: {
          message: 'Not Found'
        }
      }
    })
  })

  it('should throw NETWORK_ERROR when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({ url: 'https://api.example.com/error' })
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      config: {
        url: 'https://api.example.com/error'
      }
    })
  })

  it('should validate headers when used without the client pipeline', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/invalid-headers',
        headers: {
          'x-invalid': 'line one\nline two'
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })
    expect(fetchMock).not.toHaveBeenCalled()
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

  it.each([204, 205])(
    'should return undefined without cloning a %i response',
    async status => {
      const raw = new Response(null, {
        status
      })
      const clone = vi.spyOn(raw, 'clone')

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(raw)
      )

      const adapter = new FetchAdapter()

      const response = await adapter.request({
        url: 'https://api.example.com/empty'
      })

      expect(response.data).toBeUndefined()
      expect(clone).not.toHaveBeenCalled()
    }
  )

  it('should preserve HTTP_ERROR for a bodyless 304 response', async () => {
    const raw = new Response(null, {
      status: 304,
      statusText: 'Not Modified',
      headers: {
        'content-type': 'application/json'
      }
    })
    const clone = vi.spyOn(raw, 'clone')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(raw)
    )

    await expect(
      new FetchAdapter().request({
        url: 'https://api.example.com/not-modified'
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 304,
      data: undefined,
      response: {
        status: 304,
        data: undefined
      }
    })
    expect(clone).not.toHaveBeenCalled()
  })

  it('should classify validateStatus callback failures as config errors', async () => {
    const cause = new Error('status validation failed')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('ok'))
    )

    await expect(
      new FetchAdapter().request({
        url: 'https://api.example.com/status',
        validateStatus() {
          throw cause
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      status: 200,
      cause
    })
  })

  it('should reject a response larger than maxResponseSize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('response-too-large', {
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    const adapter = new FetchAdapter()

    await expect(
      adapter.request({
        url: 'https://api.example.com/large',
        maxResponseSize: 8,
        responseType: 'text'
      })
    ).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
      status: 200
    })
  })

  it('should allow a response exactly at maxResponseSize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('1234', {
          headers: {
            'content-length': '4',
            'content-type': 'text/plain'
          }
        })
      )
    )

    const response = await new FetchAdapter().request<string>({
      url: 'https://api.example.com/exact-size',
      maxResponseSize: 4,
      responseType: 'text'
    })

    expect(response.data).toBe('1234')
  })

  it('should enforce maxResponseSize while a stream is consumed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'))
        controller.enqueue(new TextEncoder().encode('second'))
        controller.close()
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(stream))
    )

    const adapter = new FetchAdapter()
    const response = await adapter.request<ReadableStream<Uint8Array>>({
      url: 'https://api.example.com/stream',
      maxResponseSize: 6,
      responseType: 'stream'
    })
    const reader = response.data.getReader()

    await expect(reader.read()).resolves.toMatchObject({
      done: false
    })
    await expect(reader.read()).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE'
    })
  })

  it('should preserve the size error when stream cancellation fails', async () => {
    const cancel = vi.fn(() => {
      throw new Error('cancel failed')
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'))
        controller.enqueue(new TextEncoder().encode('second'))
      },
      cancel
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(stream))
    )

    const response = await new FetchAdapter().request<
      ReadableStream<Uint8Array>
    >({
      url: 'https://api.example.com/stream-cancel-error',
      maxResponseSize: 6,
      responseType: 'stream'
    })
    const reader = response.data.getReader()

    await expect(reader.read()).resolves.toMatchObject({
      done: false
    })
    await expect(reader.read()).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE'
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('should not parse a HEAD response body', async () => {
    const raw = new Response(null, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '128'
      }
    })
    const clone = vi.spyOn(raw, 'clone')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(raw)
    )

    const adapter = new FetchAdapter()
    const response = await adapter.request<void>({
      url: 'https://api.example.com/resource',
      method: 'HEAD'
    })

    expect(response.data).toBeUndefined()
    expect(response.headers.get('content-length')).toBe('128')
    expect(clone).not.toHaveBeenCalled()
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
