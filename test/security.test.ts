import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import type {
  Adapter,
  NporaResponse,
  RequestConfig,
  RequestExtensions
} from '../src'
import {
  createClient,
  circuitBreakerPlugin,
  loggerPlugin,
  RequestError
} from '../src'
import { isURLSearchParams } from '../src/utils/isURLSearchParams'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createAdapter(
  requests: RequestConfig[]
): Adapter {
  return {
    async request<T>(
      config: RequestConfig
    ): Promise<NporaResponse<T>> {
      requests.push(config)

      return {
        data: {
          ok: true
        } as T,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        config,
        raw: new Response()
      }
    }
  }
}

describe('security boundaries', () => {
  it('should reject objects that only spoof the URLSearchParams tag', () => {
    const spoofed = {
      [Symbol.toStringTag]: 'URLSearchParams',
      entries() {
        return new Map([['tag', 'spoofed']]).entries()
      },
      toString() {
        return 'tag=spoofed'
      }
    }

    expect(isURLSearchParams(new URLSearchParams('tag=native'))).toBe(true)
    expect(isURLSearchParams(spoofed)).toBe(false)
  })

  it('should reject header injection before calling an adapter', async () => {
    const requests: RequestConfig[] = []
    const request = createClient({
      adapter: createAdapter(requests)
    })

    await expect(
      request.get('/safe', {
        headers: {
          'x-input': 'safe\r\nx-injected: true'
        }
      })
    ).rejects.toMatchObject({
      name: 'RequestError',
      code: 'CONFIG_ERROR'
    })

    expect(requests).toHaveLength(0)
  })

  it('should ignore inherited query and form properties', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const query = Object.assign(
      Object.create({
        inherited: 'secret'
      }),
      {
        visible: 'query'
      }
    )
    const form = Object.assign(
      Object.create({
        inherited: 'secret'
      }),
      {
        visible: 'form'
      }
    )
    const request = createClient()

    await request.post('https://api.example.com/submit', {
      query,
      form
    })

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit
    ]

    expect(url).toBe(
      'https://api.example.com/submit?visible=query'
    )
    expect(String(init.body)).toBe('visible=form')
  })

  it('should not allow extension keys to pollute object prototypes', async () => {
    const requests: RequestConfig[] = []
    const extensions = Object.create(null) as (
      RequestExtensions &
      Record<string, unknown>
    )

    Object.defineProperty(extensions, '__proto__', {
      value: {
        polluted: true
      },
      enumerable: true
    })

    const request = createClient({
      adapter: createAdapter(requests),
      extensions
    })

    await request.get('/safe')

    expect(
      (Object.prototype as Record<string, unknown>).polluted
    ).toBeUndefined()
    expect(Object.getPrototypeOf(requests[0]?.extensions)).toBe(
      Object.prototype
    )
  })

  it.each([
    ['baseURL', 'https://evil.example.com'],
    ['extensions', {
      retry: 10
    }]
  ])('should reject inherited request config field %s', async (key, value) => {
    const requests: RequestConfig[] = []
    const request = createClient({
      adapter: createAdapter(requests)
    })

    Object.defineProperty(Object.prototype, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    })

    try {
      await expect(request.get('/safe')).rejects.toMatchObject({
        code: 'CONFIG_ERROR',
        message: 'Request config contains inherited fields'
      })

      expect(requests).toHaveLength(0)
    } finally {
      delete (Object.prototype as Record<string, unknown>)[key]
    }
  })

  it('should reject reserved fields inherited from an interceptor result', async () => {
    const requests: RequestConfig[] = []
    const request = createClient({
      adapter: createAdapter(requests)
    })

    request.interceptors.request.use(config => {
      return Object.assign(Object.create({
        baseURL: 'https://evil.example.com'
      }), config)
    })

    await expect(request.get('/safe')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request config contains inherited fields'
    })
    expect(requests).toHaveLength(0)
  })

  it('should not promote inherited nested request fields during merge', async () => {
    const requests: RequestConfig[] = []
    const request = createClient({
      adapter: createAdapter(requests)
    })
    const config = Object.assign(
      Object.create({
        headers: {
          authorization: 'Bearer inherited-secret'
        },
        extensions: {
          retry: 10
        }
      }),
      {
        timeout: 1000
      }
    ) as RequestConfig

    await request.get('/safe', config)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers).toBeUndefined()
    expect(requests[0]?.extensions).toBeUndefined()
  })

  it('should not merge inherited default plugin options into overrides', async () => {
    const requests: RequestConfig[] = []
    const extensions = Object.assign(
      Object.create({
        retry: {
          retries: 9,
          delay: 60000
        }
      }),
      {
        logger: false
      }
    ) as RequestExtensions
    const request = createClient({
      adapter: createAdapter(requests),
      extensions
    })

    await request.get('/safe', {
      extensions: {
        retry: { retries: 1 }
      }
    })

    expect(requests[0]?.extensions?.retry).toEqual({
      retries: 1
    })
  })

  it('should isolate normalized defaults from later prototype changes', async () => {
    const requests: RequestConfig[] = []
    const request = createClient({
      adapter: createAdapter(requests),
      timeout: 1000
    })

    Object.defineProperty(Object.prototype, 'headers', {
      value: {
        authorization: 'Bearer late-inherited-secret'
      },
      configurable: true
    })

    try {
      await request.get('/safe', {
        headers: { 'x-safe': 'true' }
      })

      const headers = new Headers(requests[0]?.headers)

      expect(headers.get('x-safe')).toBe('true')
      expect(headers.has('authorization')).toBe(false)
    } finally {
      delete (Object.prototype as Record<string, unknown>).headers
    }
  })

  it('should ignore inherited client adapters', async () => {
    const inheritedRequests: RequestConfig[] = []
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' }
      })
    ))
    const options = Object.assign(
      Object.create({
        adapter: createAdapter(inheritedRequests)
      }),
      {
        timeout: 1000
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    const parent = createClient(options)
    const child = parent.extend(Object.create({
      adapter: createAdapter(inheritedRequests)
    }))

    await parent.get('/parent')
    await child.get('/child')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(inheritedRequests).toHaveLength(0)
  })

  it('should redact URL credentials and repeated secret query values', async () => {
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => {})
    const request = createClient({
      adapter: createAdapter([])
    }).use(loggerPlugin())

    await request.get(
      'https://user:password@example.com/profile' +
        '?TOKEN=first&TOKEN=second&view=full'
    )
    await request.get(
      '//other-user:other-password@example.com/profile' +
        '?api_key=third'
    )

    const serializedLogs = JSON.stringify(logSpy.mock.calls)

    expect(serializedLogs).not.toContain('user')
    expect(serializedLogs).not.toContain('password')
    expect(serializedLogs).not.toContain('first')
    expect(serializedLogs).not.toContain('second')
    expect(serializedLogs).not.toContain('third')
    expect(serializedLogs).toContain('[REDACTED]@example.com')
    expect(serializedLogs).toContain('view=full')
  })

  it('should expose validation failures through stable error types', async () => {
    const request = createClient({
      adapter: createAdapter([])
    })

    await expect(
      request.get('/invalid', {
        timeout: Number.POSITIVE_INFINITY
      })
    ).rejects.toSatisfy(error => {
      return (
        error instanceof RequestError &&
        error.code === 'CONFIG_ERROR'
      )
    })
  })

  it('should not expose URL credentials or query values in circuit errors', async () => {
    const adapter = {
      async request(config: RequestConfig): Promise<NporaResponse> {
        throw new RequestError('upstream failed', {
          code: 'NETWORK_ERROR',
          config
        })
      }
    }
    const request = createClient({ adapter }).use(
      circuitBreakerPlugin({
        failureThreshold: 1
      })
    )
    const url = 'https://user:password@example.com/private?token=secret'

    await expect(request.get(url)).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })

    let circuitError: unknown

    try {
      await request.get(url)
    } catch (error) {
      circuitError = error
    }

    expect(circuitError).toMatchObject({
      code: 'CIRCUIT_OPEN'
    })
    expect(String(circuitError)).toContain('https://example.com')
    expect(String(circuitError)).not.toContain('user')
    expect(String(circuitError)).not.toContain('password')
    expect(String(circuitError)).not.toContain('secret')
  })
})
