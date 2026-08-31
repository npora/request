import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  FetchAdapter,
  type JsonParserContext,
  RequestError
} from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FetchAdapter', () => {
  it('should use a configured Fetch implementation', async () => {
    const globalFetch = vi.fn()
    const customFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'custom' }), {
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', globalFetch)

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/custom',
      fetch: customFetch
    })).resolves.toMatchObject({
      data: {
        source: 'custom'
      }
    })
    expect(customFetch).toHaveBeenCalledWith(
      'https://api.example.com/custom',
      expect.objectContaining({ method: 'GET' })
    )
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('should inherit and override a client Fetch implementation', async () => {
    const defaultFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'default' }), {
        headers: { 'content-type': 'application/json' }
      })
    )
    const requestFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'request' }), {
        headers: { 'content-type': 'application/json' }
      })
    )
    const request = createClient({ fetch: defaultFetch })

    await expect(request.get('/default')).resolves.toEqual({
      source: 'default'
    })
    await expect(request.get('/override', {
      fetch: requestFetch
    })).resolves.toEqual({
      source: 'request'
    })

    expect(defaultFetch).toHaveBeenCalledTimes(1)
    expect(requestFetch).toHaveBeenCalledTimes(1)
  })

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

  it.each([
    ['native response parsing', undefined],
    ['size-limited parsing', 1024]
  ])('should parse FormData with %s', async (_label, maxResponseSize) => {
    const boundary = 'npora-fetch-boundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'Npora',
      `--${boundary}`,
      'Content-Disposition: form-data; name="role"',
      '',
      'client',
      `--${boundary}--`,
      ''
    ].join('\r\n')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, {
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`
        }
      })
    ))

    const response = await new FetchAdapter().request<FormData>({
      url: 'https://api.example.com/form-data',
      responseType: 'formData',
      maxResponseSize
    })

    expect([...response.data.entries()]).toEqual([
      ['name', 'Npora'],
      ['role', 'client']
    ])
  })

  it('should normalize malformed FormData response failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('not multipart', {
        headers: {
          'content-type': 'multipart/form-data'
        }
      })
    ))

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/malformed-form-data',
      responseType: 'formData'
    })).rejects.toMatchObject({
      code: 'PARSER_ERROR',
      status: 200
    })
  })

  it('should parse URL-encoded responses as FormData', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('name=Npora&role=client', {
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
        }
      })
    ))

    const response = await new FetchAdapter().request<FormData>({
      url: 'https://api.example.com/url-encoded',
      responseType: 'formData'
    })

    expect([...response.data.entries()]).toEqual([
      ['name', 'Npora'],
      ['role', 'client']
    ])
  })

  it('should use native Response.bytes when available', async () => {
    const raw = new Response('ignored')
    const bytes = vi.fn().mockResolvedValue(
      new Uint8Array([0x6e, 0x70, 0x6f, 0x72, 0x61])
    )

    Object.defineProperty(raw, 'bytes', { value: bytes })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(raw))

    const response = await new FetchAdapter().requestValidated<Uint8Array>(
      {
        url: 'https://api.example.com/bytes',
        responseType: 'bytes'
      },
      new Headers(),
      false
    )

    expect(response.data).toEqual(
      new Uint8Array([0x6e, 0x70, 0x6f, 0x72, 0x61])
    )
    expect(bytes).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['arrayBuffer fallback', undefined],
    ['size-limited read', 5]
  ])('should parse bytes through the %s path', async (_label, maxResponseSize) => {
    const raw = new Response(new Uint8Array([1, 2, 3, 4, 5]))

    Object.defineProperty(raw, 'bytes', { value: undefined })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(raw))

    const response = await new FetchAdapter().request<Uint8Array>({
      url: 'https://api.example.com/portable-bytes',
      responseType: 'bytes',
      maxResponseSize
    })

    expect(response.data).toBeInstanceOf(Uint8Array)
    expect([...response.data]).toEqual([1, 2, 3, 4, 5])
  })

  it('should parse size-limited JSON with an async custom parser', async () => {
    let parserContext: JsonParserContext | undefined
    const parseJson = vi.fn(async (
      text: string,
      context: JsonParserContext
    ) => {
      parserContext = context

      return {
        value: JSON.parse(text).value.toUpperCase()
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"value":"npora"}', {
          headers: {
            'content-type': 'application/json',
            'x-parser': 'fetch'
          }
        })
      )
    )

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/custom-json',
      maxResponseSize: 100,
      parseJson
    })).resolves.toMatchObject({
      data: { value: 'NPORA' }
    })
    expect(parseJson).toHaveBeenCalledOnce()
    expect(parserContext?.config).toMatchObject({
      url: 'https://api.example.com/custom-json',
      maxResponseSize: 100
    })
    expect(parserContext?.response.status).toBe(200)
    expect(parserContext?.response.headers.get('x-parser')).toBe('fetch')
  })

  it('should custom-parse JSON error response data', async () => {
    let parserStatus: number | undefined
    let parserConfig: JsonParserContext['config'] | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"message":"busy"}', {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/busy',
      maxErrorResponseSize: 100,
      parseJson: (text, { config, response }) => {
        parserStatus = response.status
        parserConfig = config

        return {
          message: JSON.parse(text).message.toUpperCase()
        }
      }
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      data: { message: 'BUSY' }
    })
    expect(parserStatus).toBe(503)
    expect(parserConfig?.maxErrorResponseSize).toBe(100)
    expect(parserConfig?.maxResponseSize).toBeUndefined()
  })

  it('should normalize custom JSON parser failures', async () => {
    const parserFailure = new Error('unsafe JSON')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"value":1}', {
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/custom-json',
      parseJson: async () => {
        throw parserFailure
      }
    })).rejects.toMatchObject({
      code: 'PARSER_ERROR',
      cause: parserFailure
    })
  })

  it.each([
    ['native JSON parser', undefined],
    ['custom JSON parser', async () => {
      throw new Error('custom parser rejected the error payload')
    }]
  ])(
    'should preserve HTTP_ERROR when the %s rejects error data',
    async (_label, parseJson) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('invalid-json', {
            status: 422,
            statusText: 'Unprocessable Content',
            headers: { 'content-type': 'application/json' }
          })
        )
      )

      let caught: unknown

      try {
        await new FetchAdapter().request({
          url: 'https://api.example.com/invalid-error-json',
          parseJson
        })
      } catch (error) {
        caught = error
      }

      expect(caught).toMatchObject({
        code: 'HTTP_ERROR',
        status: 422,
        data: undefined,
        response: {
          data: undefined
        }
      })
      expect(caught).toBeInstanceOf(RequestError)

      const error = caught as RequestError

      expect(await error.response?.raw.text()).toBe('invalid-json')
    }
  )

  it('should bound stalled HTTP error body reads by default', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(new ReadableStream({
            pull() {
              return new Promise(() => {})
            },
            cancel
          }), {
            status: 503,
            headers: { 'content-type': 'text/plain' }
          })
        )
      )

      const pending = new FetchAdapter().request({
        url: '/stalled-error'
      })
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'HTTP_ERROR',
        status: 503,
        data: undefined
      })

      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('should bound asynchronous HTTP error JSON parsing by default', async () => {
    vi.useFakeTimers()

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('{"message":"busy"}', {
            status: 503,
            headers: { 'content-type': 'application/json' }
          })
        )
      )

      const pending = new FetchAdapter().request({
        url: '/stalled-parser',
        parseJson: () => new Promise(() => {})
      })
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'HTTP_ERROR',
        status: 503,
        data: undefined
      })

      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('should preserve an explicit timeout during HTTP error parsing', async () => {
    vi.useFakeTimers()

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('{"message":"busy"}', {
            status: 503,
            headers: { 'content-type': 'application/json' }
          })
        )
      )

      const pending = new FetchAdapter().request({
        url: '/timed-parser',
        timeout: 25,
        parseJson: () => new Promise(() => {})
      })
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR'
      })

      await vi.advanceTimersByTimeAsync(25)
      await assertion
    } finally {
      vi.useRealTimers()
    }
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

  it('should not buffer HTTP error bodies above the default safety limit', async () => {
    const nativeResponse = new Response('oversized', {
      status: 502,
      headers: {
        'content-length': String(10 * 1024 * 1024 + 1),
        'content-type': 'text/plain'
      }
    })
    const clone = vi.spyOn(nativeResponse, 'clone')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nativeResponse))

    let captured: RequestError | undefined

    try {
      await new FetchAdapter().request({
        url: '/large-error'
      })
    } catch (error) {
      captured = error as RequestError
    }

    expect(clone).not.toHaveBeenCalled()
    expect(captured).toMatchObject({
      code: 'HTTP_ERROR',
      status: 502,
      data: undefined,
      response: {
        data: undefined
      }
    })
    expect(captured?.response?.raw.bodyUsed).toBe(true)
  })

  it('should stop reading a chunked HTTP error body at its error limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('too large'))
            controller.close()
          }
        }), {
          status: 500,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    await expect(new FetchAdapter().request<string>({
      url: '/chunked-error',
      maxErrorResponseSize: 4
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500,
      data: undefined
    })
  })

  it('should preserve an explicit stricter response limit for HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('too large', {
          status: 500,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    await expect(new FetchAdapter().request<string>({
      url: '/strict-error',
      maxResponseSize: 4,
      maxErrorResponseSize: 8
    })).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
      status: 500
    })
  })

  it('should ignore the error-body guard when HTTP errors resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not found', {
          status: 404,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    await expect(new FetchAdapter().request<string>({
      url: '/soft-error',
      throwHttpErrors: false,
      maxErrorResponseSize: 0
    })).resolves.toMatchObject({
      status: 404,
      data: 'not found'
    })
  })

  it('should allow unlimited HTTP error parsing when explicitly requested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('full error', {
          status: 500,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    await expect(new FetchAdapter().request<string>({
      url: '/unlimited-error',
      maxErrorResponseSize: Number.POSITIVE_INFINITY
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      data: 'full error'
    })
  })

  it('should return parsed HTTP error responses when throwing is disabled', async () => {
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

    await expect(new FetchAdapter().request<{ message: string }>({
      url: 'https://api.example.com/not-found',
      throwHttpErrors: false
    })).resolves.toMatchObject({
      status: 404,
      data: {
        message: 'Not Found'
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

  it('should preserve a branded error from another package instance', async () => {
    const foreignError = new Error('foreign timeout') as Error & {
      code: string
    }

    foreignError.name = 'RequestError'
    foreignError.code = 'TIMEOUT_ERROR'
    Object.defineProperty(
      foreignError,
      Symbol.for('@npora/request/RequestError'),
      { value: true }
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(foreignError))

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/foreign-error'
    })).rejects.toBe(foreignError)
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
      const getHeader = vi.spyOn(raw.headers, 'get')

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
      expect(getHeader).not.toHaveBeenCalled()
    }
  )

  it.each(['opaque', 'opaqueredirect'] as const)(
    'should resolve an unreadable %s response without parsing it',
    async type => {
      const raw = createFilteredResponse(type)
      const clone = vi.spyOn(raw, 'clone')
      const getHeader = vi.spyOn(raw.headers, 'get')

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(raw)
      )

      const response = await new FetchAdapter().request<void>({
        url: 'https://cross-origin.example.com/resource'
      })

      expect(response).toMatchObject({
        data: undefined,
        status: 0,
        raw
      })
      expect(clone).not.toHaveBeenCalled()
      expect(getHeader).not.toHaveBeenCalled()
    }
  )

  it('should let validateStatus reject an opaque response explicitly', async () => {
    const raw = createFilteredResponse('opaque')
    const clone = vi.spyOn(raw, 'clone')
    const validateStatus = vi.fn().mockReturnValue(false)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(raw)
    )

    await expect(new FetchAdapter().request({
      url: 'https://cross-origin.example.com/resource',
      validateStatus
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 0,
      data: undefined
    })
    expect(validateStatus).toHaveBeenCalledOnce()
    expect(validateStatus).toHaveBeenCalledWith(0)
    expect(clone).not.toHaveBeenCalled()
  })

  it('should classify a custom Fetch error response without parsing it', async () => {
    const raw = Response.error()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(raw)
    )

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/error-response',
      throwHttpErrors: false
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 0,
      data: undefined
    })
  })

  it('should preserve HTTP_ERROR for a bodyless 304 response', async () => {
    const raw = new Response(null, {
      status: 304,
      statusText: 'Not Modified',
      headers: {
        'content-type': 'application/json'
      }
    })
    const clone = vi.spyOn(raw, 'clone')
    const getHeader = vi.spyOn(raw.headers, 'get')

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
    expect(getHeader).not.toHaveBeenCalled()
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
    const getHeader = vi.spyOn(raw.headers, 'get')

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
    expect(getHeader).toHaveBeenCalledTimes(1)
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

function createFilteredResponse(
  type: 'opaque' | 'opaqueredirect'
): Response {
  const response = new Response(null)

  Object.defineProperties(response, {
    status: {
      configurable: true,
      value: 0
    },
    type: {
      configurable: true,
      value: type
    }
  })

  return response
}
