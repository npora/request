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
      'https://api.example.com/users?page=1&keyword=npora&active=true&tags=ts&tags=fetch'
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
      'https://api.example.com/search?search=hello+world%7E&tags=first&tags=second#results'
    )
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

  it('should serialize form body', () => {
    const { init } = buildRequest({
      url: '/login',
      method: 'POST',
      form: {
        username: 'npora',
        remember: true
      }
    })

    const headers = init.headers as Headers
    const body = init.body as URLSearchParams

    expect(headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8'
    )
    expect(body.toString()).toBe('username=npora&remember=true')
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
    ['maxResponseSize', -1],
    ['maxResponseSize', 1.5],
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
