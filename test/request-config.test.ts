import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import type { Plugin } from '../src'
import { createClient, MockAdapter } from '../src'
import { buildRequest } from '../src/utils/buildRequest'
import { validateRequestConfig } from '../src/utils/validateRequestConfig'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('request config', () => {
  it('should preserve an unchanged native Request as the fetch input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('ok', {
        headers: { 'content-type': 'text/plain' }
      })
    )
    const input = new Request('https://api.example.com/native', {
      method: 'POST',
      body: 'native body'
    })

    await createClient({ fetch: fetchMock }).request(input)

    expect(fetchMock).toHaveBeenCalledWith(input, undefined)
    expect(input.bodyUsed).toBe(false)
  })

  it('should accept a native Request with per-call overrides', async () => {
    let sentBody = ''
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = await new Response(init?.body).text()
      return new Response('ok')
    })
    const controller = new AbortController()
    const input = new Request('https://api.example.com/native?first=1', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-input': 'yes'
      },
      body: 'native body',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    })

    vi.stubGlobal('fetch', fetchMock)

    await createClient({
      headers: { 'x-default': 'yes' }
    }).request(input, {
      headers: { 'x-override': 'yes' },
      query: { second: 2 },
      responseType: 'text',
      fetchOptions: { cache: 'reload' }
    })

    const [url, init] = fetchMock.mock.calls[0]!

    expect(url).toBe(
      'https://api.example.com/native?first=1&second=2'
    )
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(input.signal)
    expect(init.cache).toBe('reload')
    expect(init.credentials).toBe('omit')
    expect(init.duplex).toBe('half')
    expect(new Headers(init.headers).get('x-input')).toBe('yes')
    expect(new Headers(init.headers).get('x-default')).toBe('yes')
    expect(new Headers(init.headers).get('x-override')).toBe('yes')
    expect(sentBody).toBe('native body')
    controller.abort('stop')
    expect(input.signal.aborted).toBe(true)
    expect(input.signal.reason).toBe('stop')
  })

  it('should allow native Request body and method replacement', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    const input = new Request('https://api.example.com/native', {
      method: 'POST',
      body: 'original'
    })

    vi.stubGlobal('fetch', fetchMock)

    await createClient().requestResponse(input, {
      method: 'PUT',
      body: 'replacement',
      responseType: 'text'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/native',
      expect.objectContaining({
        method: 'PUT',
        body: 'replacement'
      })
    )
    expect(input.bodyUsed).toBe(false)
  })

  it('should accept and snapshot a native URL input', async () => {
    let releaseInterceptor: (() => void) | undefined
    const interceptorReady = new Promise<void>(resolve => {
      releaseInterceptor = resolve
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    const input = new URL(
      'https://api.example.com/users?existing=true#results'
    )
    const request = createClient()

    request.interceptors.request.use(async config => {
      await interceptorReady
      return config
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = request.get(input, {
      query: { page: 2 }
    })

    input.pathname = '/mutated'
    releaseInterceptor?.()
    await pending

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users?existing=true&page=2#results',
      expect.any(Object)
    )
  })

  it('should accept URL input in the direct request API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))

    vi.stubGlobal('fetch', fetchMock)

    await createClient().request({
      url: new URL('https://api.example.com/direct'),
      responseType: 'text'
    })

    expect(fetchMock.mock.calls[0]?.[0])
      .toBe('https://api.example.com/direct')
  })

  it('should enforce the absolute URL boundary for URL objects', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient({
      baseURL: 'https://api.example.com',
      allowAbsoluteUrls: false
    }).get(new URL('https://other.example.com/users')))
      .rejects.toMatchObject({
        code: 'CONFIG_ERROR',
        message: 'Absolute request URLs are not allowed with this baseURL'
      })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject URL-shaped objects', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().request({
      url: {
        href: 'https://api.example.com/spoofed',
        toString() {
          return this.href
        }
      } as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request url must be a string or URL'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should expose merged context without sending it', async () => {
    const observed: Array<Record<string, unknown> | undefined> = []
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    const plugin: Plugin = {
      name: 'context-observer',
      install({ hooks }) {
        hooks.onRequest(requestContext => {
          observed.push(requestContext.config.context)
        })
      }
    }

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      context: {
        traceId: 'trace-1',
        nested: { source: 'default' }
      }
    }).use(plugin)
    const response = await request.getResponse('/users', {
      context: {
        operation: 'load-users',
        nested: { source: 'request' }
      }
    })

    expect(observed).toEqual([{
      traceId: 'trace-1',
      operation: 'load-users',
      nested: { source: 'request' }
    }])
    expect(response.config.context).toEqual(observed[0])
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('context')
  })

  it.each([null, [], 'trace'])('should reject invalid context %j', async context => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().get('/users', {
      context: context as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request context must be an object'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should only materialize optional headers when needed', () => {
    expect(validateRequestConfig({
      url: '/users'
    }, false)).toBeUndefined()

    expect(validateRequestConfig({
      url: '/users',
      headers: {
        accept: 'application/json'
      }
    }, false)).toBeInstanceOf(Headers)
  })

  it.each([
    ['json', 'application/json'],
    ['text', 'text/*'],
    ['blob', '*/*'],
    ['arrayBuffer', '*/*'],
    ['bytes', '*/*'],
    ['formData', 'multipart/form-data'],
    ['stream', '*/*'],
    ['sse', 'text/event-stream'],
    ['ndjson', 'application/x-ndjson, application/ndjson']
  ] as const)(
    'should negotiate an explicit %s response',
    (responseType, accept) => {
      const request = buildRequest({
        url: '/representation',
        responseType
      })

      expect(new Headers(request.init.headers).get('accept'))
        .toBe(accept)
    }
  )

  it('should preserve a custom Accept header', () => {
    const request = buildRequest({
      url: '/problem',
      responseType: 'json',
      headers: {
        Accept: 'application/problem+json'
      }
    })

    expect(new Headers(request.init.headers).get('accept'))
      .toBe('application/problem+json')
  })

  it('should not guess Accept without an explicit response type', () => {
    const request = buildRequest({
      url: '/representation',
      json: { enabled: true },
      method: 'POST'
    })
    const headers = new Headers(request.init.headers)

    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.has('accept')).toBe(false)
  })

  it.each([
    'authorization',
    ['authorization', 42],
    ['invalid header name']
  ])('should reject invalid removeHeaders value %j', async removeHeaders => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().get('/public', {
      removeHeaders: removeHeaders as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject a non-function Fetch implementation', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().get('/users', {
      fetch: 'invalid' as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request fetch must be a function'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['parseJson', 'Request parseJson must be a function'],
    ['stringifyJson', 'Request stringifyJson must be a function'],
    ['querySerializer', 'Request querySerializer must be a function']
  ])('should reject an invalid %s callback', async (field, message) => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().get('/users', {
      [field]: 'invalid'
    } as never)).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should build url with baseURL and query', () => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com',
      url: '/users',
      query: {
        page: 1,
        keyword: 'npora',
        active: true,
        empty: null,
        tags: ['ts', 'fetch']
      }
    })

    expect(url).toBe(
      'https://api.example.com/users?page=1&keyword=npora&active=true&empty=&tags=ts&tags=fetch'
    )
  })

  it('should normalize baseURL joins and preserve hash fragments', () => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com/v1/',
      url: '/users?active=true#results',
      query: {
        page: 1
      }
    })

    expect(url).toBe(
      'https://api.example.com/v1/users?active=true&page=1#results'
    )
  })

  it('should merge baseURL query and fragment components safely', () => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com/v1/?tenant=npora#base',
      url: '/users?active=true#results',
      query: {
        page: 1
      }
    })

    expect(url).toBe(
      'https://api.example.com/v1/users?tenant=npora&active=true&page=1#results'
    )
  })

  it('should preserve a baseURL fragment when the request has none', () => {
    const { url } = buildRequest({
      baseURL: '/api?tenant=npora#base',
      url: '/users'
    })

    expect(url).toBe('/api/users?tenant=npora#base')
  })

  it('should keep query delimiters inside fragments opaque', () => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com/v1#route?tab=base',
      url: '/users#result?tab=request'
    })

    expect(url).toBe(
      'https://api.example.com/v1/users#result?tab=request'
    )
  })

  it.each([
    ['?active=true', 'https://api.example.com/v1?active=true'],
    ['#results', 'https://api.example.com/v1#results']
  ])('should resolve a suffix-only request URL %s', (input, expected) => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com/v1',
      url: input
    })

    expect(url).toBe(expected)
  })

  it('should preserve query encoding and array order', () => {
    const inheritedQuery = Object.create({
      inherited: 'ignored'
    }) as Record<string, unknown>

    inheritedQuery.search = 'hello world~'
    inheritedQuery.tags = [
      'first',
      null,
      'second',
      undefined
    ]

    const { url } = buildRequest({
      baseURL: 'https://api.example.com///',
      url: '/search#results',
      query: inheritedQuery as never
    })

    expect(url).toBe(
      'https://api.example.com/search?search=hello+world%7E&tags=first&tags=&tags=second#results'
    )
  })

  it('should serialize object query parameters with a custom callback', () => {
    const querySerializer = vi.fn(query => {
      const tags = query.tags as string[]

      return `?tags[]=${tags.join('&tags[]=')}`
    })
    const { url } = buildRequest({
      url: '/search?active=true#results',
      query: { tags: ['first', 'second'] },
      querySerializer
    })

    expect(url).toBe(
      '/search?active=true&tags[]=first&tags[]=second#results'
    )
    expect(querySerializer).toHaveBeenCalledWith({
      tags: ['first', 'second']
    })
  })

  it.each([
    {
      querySerializer: () => 42,
      message: 'Request querySerializer must return a string'
    },
    {
      querySerializer: () => {
        throw new Error('serializer failed')
      },
      message: 'Request query serialization failed'
    }
  ])('should reject invalid custom query serialization', async ({
    querySerializer,
    message
  }) => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().get('/search', {
      query: { page: 1 },
      querySerializer: querySerializer as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should accept searchParams without losing repeated-key order', () => {
    const query = new URLSearchParams([
      ['tag', 'first'],
      ['search', 'hello world~'],
      ['tag', 'second']
    ])
    const { url } = buildRequest({
      url: '/search?existing=true#results',
      searchParams: query
    })

    expect(url).toBe(
      '/search?existing=true&tag=first&search=hello+world%7E&tag=second#results'
    )
    expect([...query.entries()]).toEqual([
      ['tag', 'first'],
      ['search', 'hello world~'],
      ['tag', 'second']
    ])
  })

  it('should not prepend baseURL to an absolute request URL', () => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com',
      url: 'https://uploads.example.com/file'
    })

    expect(url).toBe('https://uploads.example.com/file')
  })

  it.each([
    'https://uploads.example.com/file',
    '//uploads.example.com/file'
  ])('should reject absolute URL %s when baseURL bypass is disabled', async url => {
    const adapter = new MockAdapter()
    const request = createClient({
      adapter,
      baseURL: 'https://api.example.com',
      allowAbsoluteUrls: false
    })

    await expect(
      request.get(url)
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Absolute request URLs are not allowed with this baseURL'
    })
    expect(adapter.history).toHaveLength(0)
  })

  it('should allow absolute URLs without baseURL when bypass is disabled', async () => {
    const adapter = new MockAdapter()

    adapter.onGet('https://api.example.com/file').reply(200, {
      ok: true
    })

    const result = await createClient({
      adapter,
      allowAbsoluteUrls: false
    }).get('https://api.example.com/file')

    expect(result).toEqual({ ok: true })
  })

  it('should validate allowAbsoluteUrls before adapter dispatch', async () => {
    const adapter = new MockAdapter()
    const request = createClient({ adapter })

    await expect(request.get('/file', {
      allowAbsoluteUrls: 'no' as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request allowAbsoluteUrls must be a boolean'
    })
    expect(adapter.history).toHaveLength(0)
  })

  it('should reject absolute URLs introduced by interceptors', async () => {
    const adapter = new MockAdapter()
    const request = createClient({
      adapter,
      baseURL: 'https://api.example.com',
      allowAbsoluteUrls: false
    })

    request.interceptors.request.use(config => ({
      ...config,
      url: 'https://evil.example.com/redirected'
    }))

    await expect(request.get('/safe')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Absolute request URLs are not allowed with this baseURL'
    })
    expect(adapter.history).toHaveLength(0)
  })

  it.each([
    {
      config: {
        url: 'https:uploads.example.com/file'
      },
      message: 'Request URL is malformed'
    },
    {
      config: {
        url: '/file',
        baseURL: 'https:/api.example.com'
      },
      message: 'Request URL is malformed'
    },
    {
      config: {
        url: '/file',
        baseURL: 42
      },
      message: 'Request baseURL must be a string'
    }
  ])('should reject unsafe URL configuration before fetch', async ({
    config,
    message
  }) => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createClient().request(config as never)
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'mailto:team@example.com',
    '//cdn.example.com/file'
  ])(
    'should preserve absolute URL form %s',
    absoluteURL => {
      const { url } = buildRequest({
        baseURL: 'https://api.example.com',
        url: absoluteURL
      })

      expect(url).toBe(absoluteURL)
    }
  )

  it('should pass native Fetch options to RequestInit', () => {
    const { init } = buildRequest({
      url: '/users',
      fetchOptions: {
        credentials: 'include',
        redirect: 'manual',
        cache: 'no-store'
      }
    })

    expect(init).toMatchObject({
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store'
    })
    expect(init).not.toHaveProperty('duplex')
  })

  it('should enable half duplex for streaming request bodies', () => {
    const body = new ReadableStream<Uint8Array>()
    const request = buildRequest({
      url: 'https://api.example.com/upload',
      method: 'POST',
      body
    })

    expect(
      (request.init as RequestInit & { duplex?: string }).duplex
    ).toBe('half')
    expect(() => new Request(request.url, request.init)).not.toThrow()
  })

  it('should skip timeout controller allocation when timeout is disabled', () => {
    const abortController = vi.fn(() => {
      throw new Error('AbortController should not be created')
    })

    vi.stubGlobal('AbortController', abortController)

    const request = buildRequest({
      url: '/users',
      timeout: 0
    })

    expect(request.init.signal).toBeUndefined()
    expect(abortController).not.toHaveBeenCalled()
    expect(() => request.clear()).not.toThrow()
  })

  it('should not retain a timeout when request serialization fails', () => {
    vi.useFakeTimers()
    const signal = new AbortController().signal
    const addEventListener = vi.spyOn(signal, 'addEventListener')

    expect(() => buildRequest({
      url: '/users',
      timeout: 1000,
      signal,
      query: {
        invalid: {
          toString() {
            throw new Error('serialization failed')
          }
        } as never
      }
    })).toThrow('serialization failed')

    expect(vi.getTimerCount()).toBe(0)
    expect(addEventListener).not.toHaveBeenCalled()
  })

  it('should serialize json body', () => {
    const { init } = buildRequest({
      url: '/users',
      method: 'POST',
      json: {
        name: 'Npora'
      }
    })

    const headers = init.headers as Headers

    expect(headers.get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ name: 'Npora' }))
  })

  it.each([
    { name: 'string', value: 'npora', serialized: '"npora"' },
    { name: 'number', value: 42, serialized: '42' },
    { name: 'boolean', value: false, serialized: 'false' },
    { name: 'null', value: null, serialized: 'null' }
  ])('should serialize a $name JSON value', ({ value, serialized }) => {
    const { init } = buildRequest({
      url: '/values',
      method: 'POST',
      json: value
    })

    expect((init.headers as Headers).get('content-type')).toBe(
      'application/json'
    )
    expect(init.body).toBe(serialized)
  })

  it('should use a custom JSON stringifier for JSON body shortcuts', () => {
    const stringifyJson = vi.fn(value => JSON.stringify({ wrapped: value }))
    const jsonRequest = buildRequest({
      url: '/json',
      json: { name: 'Npora' },
      stringifyJson
    })
    const objectRequest = buildRequest({
      url: '/body',
      body: { name: 'Npora' },
      stringifyJson
    })

    expect(jsonRequest.init.body).toBe(
      '{"wrapped":{"name":"Npora"}}'
    )
    expect(objectRequest.init.body).toBe(
      '{"wrapped":{"name":"Npora"}}'
    )
    expect(stringifyJson).toHaveBeenCalledTimes(2)
  })

  it('should reject a JSON stringifier that returns a non-string', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().post('/users', {
      json: { name: 'Npora' },
      stringifyJson: (() => undefined) as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      cause: expect.objectContaining({
        message: 'Request JSON stringifier must return a string'
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'UTF-8 text',
      config: {
        body: '你好',
        maxRequestSize: 5
      }
    },
    {
      name: 'JSON',
      config: {
        json: { value: 'large' },
        maxRequestSize: 10
      }
    },
    {
      name: 'URLSearchParams',
      config: {
        form: new URLSearchParams({ value: 'large' }),
        maxRequestSize: 5
      }
    },
    {
      name: 'Blob',
      config: {
        body: new Blob(['large']),
        maxRequestSize: 4
      }
    },
    {
      name: 'ArrayBufferView',
      config: {
        body: new Uint8Array(8).subarray(2, 6),
        maxRequestSize: 3
      }
    }
  ])('should reject an oversized $name request body', ({ config }) => {
    expect(() => buildRequest({
      url: '/upload',
      method: 'POST',
      ...config
    })).toThrow(expect.objectContaining({
      code: 'REQUEST_TOO_LARGE'
    }))
  })

  it('should allow a request body exactly at maxRequestSize', () => {
    const request = buildRequest({
      url: '/upload',
      method: 'POST',
      body: '你好',
      maxRequestSize: 6
    })

    expect(request.init.body).toBe('你好')
  })

  it('should serialize form body', () => {
    const { init } = buildRequest({
      url: '/login',
      method: 'POST',
      form: {
        username: 'npora',
        remember: true,
        empty: null,
        omitted: undefined
      }
    })

    const headers = init.headers as Headers
    const body = init.body as URLSearchParams

    expect(headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8'
    )
    expect(body.toString()).toBe(
      'username=npora&remember=true&empty='
    )
  })

  it('should ignore inherited form and FormData fields', () => {
    const form = Object.create({
      inherited: 'ignored'
    }) as Record<string, unknown>
    const formData = Object.create({
      inherited: 'ignored'
    }) as Record<string, unknown>

    form.username = 'npora'
    formData.name = 'Npora'

    const formRequest = buildRequest({
      url: '/form',
      method: 'POST',
      form: form as never
    })
    const formDataRequest = buildRequest({
      url: '/form-data',
      method: 'POST',
      formData
    })

    expect(
      (formRequest.init.body as URLSearchParams).toString()
    ).toBe('username=npora')
    expect(
      Array.from(
        (formDataRequest.init.body as FormData).entries()
      )
    ).toEqual([
      ['name', 'Npora']
    ])
  })

  it('should reject circular FormData arrays before fetch', async () => {
    const fetchMock = vi.fn()
    const values: unknown[] = []

    values.push(values)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createClient().post('/form-data', {
        formData: {
          values
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      cause: {
        message: 'FormData arrays cannot contain circular references'
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should enforce maxFormDataDepth before fetch', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createClient().post('/form-data', {
        formData: {
          values: [[['too-deep']]]
        },
        maxFormDataDepth: 2
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      cause: {
        message: 'FormData array depth exceeds maxFormDataDepth 2'
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject invalid inherited searchParams before fetch', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient({
      searchParams: {
        page: 1
      } as never
    })

    await expect(client.get('/users')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request searchParams must be URLSearchParams'
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['maxRequestSize', -1],
    ['maxRequestSize', 1.5],
    ['maxResponseSize', -1],
    ['maxResponseSize', 1.5],
    ['maxErrorResponseSize', -1],
    ['maxErrorResponseSize', 1.5],
    ['maxFormDataDepth', -1],
    ['maxFormDataDepth', 1.5]
  ] as const)(
    'should reject invalid %s values',
    async (field, value) => {
      const fetchMock = vi.fn()

      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createClient().get('/invalid-limit', {
          [field]: value
        })
      ).rejects.toMatchObject({
        code: 'CONFIG_ERROR'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('should reject mutually exclusive body options', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    await expect(
      request.post('/users', {
        json: {
          name: 'Npora'
        },
        form: {
          name: 'Npora'
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      config: {
        url: '/users',
        method: 'POST'
      }
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should treat null JSON as an active body option', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().post('/users', {
      json: null,
      form: { name: 'Npora' }
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request body options are mutually exclusive: json, form'
    })

    await expect(createClient().get('/users', {
      json: null
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'GET requests cannot include a body'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should report every conflicting body option', async () => {
    const request = createClient()

    await expect(
      request.post('/users', {
        body: 'raw',
        json: {
          name: 'Npora'
        },
        form: {
          name: 'Npora'
        },
        formData: new FormData()
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message:
        'Request body options are mutually exclusive: body, json, form, formData'
    })
  })

  it.each([
    ['GET', 'get'],
    ['HEAD', 'head']
  ] as const)(
    'should reject a body on %s requests',
    async (method, requestMethod) => {
      const fetchMock = vi.fn()

      vi.stubGlobal('fetch', fetchMock)

      const request = createClient()
      const promise = request[requestMethod]('/users', {
        json: {
          invalid: true
        }
      })

      await expect(promise).rejects.toMatchObject({
        code: 'CONFIG_ERROR',
        message: `${method} requests cannot include a body`
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('should reject an inherited body on GET requests', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      json: {
        inherited: true
      }
    })

    await expect(request.get('/users')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'GET requests cannot include a body'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should validate config after plugin request hooks', async () => {
    const adapter = new MockAdapter()
    const requestSpy = vi.spyOn(adapter, 'request')
    const plugin: Plugin = {
      name: 'invalid-config',
      install({ hooks }) {
        hooks.onRequest(context => {
          context.config = {
            ...context.config,
            headers: {
              'invalid header name': 'value'
            }
          }
        })
      }
    }
    const request = createClient({
      adapter
    }).use(plugin)

    await expect(request.get('/users')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request headers are invalid'
    })
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it.each([
    Number.POSITIVE_INFINITY,
    2_147_483_648
  ])('should reject invalid timeout value %s', async timeout => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    await expect(
      request.get('/users', {
        timeout
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    Number.POSITIVE_INFINITY,
    2_147_483_648,
    -1
  ])('should reject invalid totalTimeout value %s', async totalTimeout => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().get('/users', {
      totalTimeout
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request totalTimeout is out of range'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      query: {
        page: 1
      },
      searchParams: new URLSearchParams('page=1'),
      message: 'Request query and searchParams are mutually exclusive'
    },
    {
      searchParams: {
        page: 1
      },
      message: 'Request searchParams must be URLSearchParams'
    }
  ])('should reject invalid native search parameters before fetch', async ({
    message,
    ...config
  }) => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createClient().get('/users', config as never)
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      config: {
        responseType: 'xml'
      },
      message: 'Request responseType is invalid'
    },
    {
      config: {
        validateStatus: null
      },
      message: 'Request validateStatus must be a function'
    },
    {
      config: {
        throwHttpErrors: 'no'
      },
      message: 'Request throwHttpErrors must be a boolean'
    },
    {
      config: {
        throwHttpErrors: false,
        validateStatus: () => true
      },
      message:
        'Request throwHttpErrors and validateStatus are mutually exclusive'
    }
  ])('should reject invalid response configuration before fetch', async ({
    config,
    message
  }) => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createClient().get('/users', config as never)
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject invalid headers', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    await expect(
      request.get('/users', {
        headers: {
          'invalid header name': 'value'
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request headers are invalid'
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should wrap body serialization failures as CONFIG_ERROR', async () => {
    const fetchMock = vi.fn()
    const json: Record<string, unknown> = {}

    json.self = json

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    await expect(
      request.post('/users', {
        json
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Failed to build request'
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should abort before serializing a request body', async () => {
    const controller = new AbortController()
    const serialize = vi.fn(() => {
      throw new Error('serialization should not run')
    })
    const fetchMock = vi.fn()

    controller.abort('already cancelled')
    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    await expect(request.post('/users', {
      json: {
        toJSON: serialize
      },
      signal: controller.signal
    })).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })

    expect(serialize).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
