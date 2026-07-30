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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request config', () => {
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

  it('should preserve URLSearchParams encoding and array order', () => {
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

  it('should not prepend baseURL to an absolute request URL', () => {
    const { url } = buildRequest({
      baseURL: 'https://api.example.com',
      url: 'https://uploads.example.com/file'
    })

    expect(url).toBe('https://uploads.example.com/file')
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
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message:
        'Request body options are mutually exclusive: body, json, form'
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

  it('should reject invalid timeout values', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()

    await expect(
      request.get('/users', {
        timeout: Number.POSITIVE_INFINITY
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
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
})
