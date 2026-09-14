import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/core-entry'
import { cachePlugin } from '../src/plugins/cachePlugin'
import { memoryCachePlugin } from '../src/plugins/memoryCachePlugin'

function jsonResponse(count: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ count }), {
    headers: { 'content-type': 'application/json', ...headers }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('memoryCachePlugin', () => {
  it('requires explicit enablement and omits implicit credentials', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(fetchMock.mock.calls.length)))
    vi.stubGlobal('fetch', fetchMock)

    const api = createClient().use(memoryCachePlugin())
    const url = 'https://example.com/catalog'

    expect(await api.get(url)).toEqual({ count: 1 })
    expect(await api.get(url, { extensions: { memoryCache: { enabled: true } } }))
      .toEqual({ count: 2 })
    expect(await api.get(url, { extensions: { memoryCache: { enabled: true } } }))
      .toEqual({ count: 3 })

    const safe = {
      fetchOptions: { credentials: 'omit' as const },
      extensions: { memoryCache: { enabled: true } }
    }
    expect(await api.get(url, safe)).toEqual({ count: 4 })
    expect(await api.get(url, safe)).toEqual({ count: 4 })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('keys after later request hooks add authorization headers', async () => {
    let user = 'first'
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(fetchMock.mock.calls.length)))
    vi.stubGlobal('fetch', fetchMock)

    const api = createClient({
      fetchOptions: { credentials: 'omit' },
      extensions: { memoryCache: { enabled: true } }
    }).use(memoryCachePlugin()).use({
      name: 'late-authorization',
      install(context) {
        context.hooks.onRequest(requestContext => {
          requestContext.config.headers = { authorization: `Bearer ${user}` }
        })
      }
    })

    const url = 'https://example.com/account'
    expect(await api.get(url)).toEqual({ count: 1 })
    user = 'second'
    expect(await api.get(url)).toEqual({ count: 2 })
    user = 'first'
    expect(await api.get(url)).toEqual({ count: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('isolates keys, expires entries and evicts least recently used entries', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(fetchMock.mock.calls.length)))
    vi.stubGlobal('fetch', fetchMock)

    const cache = memoryCachePlugin({ ttl: 100, maxEntries: 2 })
    const api = createClient({ fetchOptions: { credentials: 'omit' },
      extensions: { memoryCache: { enabled: true } }
    }).use(cache)

    expect(await api.get('https://example.com/a')).toEqual({ count: 1 })
    expect(await api.get('https://example.com/b')).toEqual({ count: 2 })
    expect(await api.get('https://example.com/a')).toEqual({ count: 1 })
    expect(await api.get('https://example.com/c')).toEqual({ count: 3 })
    expect(await api.get('https://example.com/b')).toEqual({ count: 4 })
    expect(await api.get('https://example.com/b')).toEqual({ count: 4 })

    vi.advanceTimersByTime(100)
    expect(await api.get('https://example.com/b')).toEqual({ count: 5 })
    cache.clear()
    expect(await api.get('https://example.com/b')).toEqual({ count: 6 })
  })

  it('respects response policy and request cache directives', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(
        fetchMock.mock.calls.length,
        fetchMock.mock.calls.length === 1
          ? { 'cache-control': 'no-store' }
          : fetchMock.mock.calls.length === 3
          ? { vary: 'accept-language' }
          : { 'cache-control': 'max-age=0' }
      )))
    vi.stubGlobal('fetch', fetchMock)
    const api = createClient({ fetchOptions: { credentials: 'omit' },
      extensions: { memoryCache: { enabled: true } }
    }).use(memoryCachePlugin())
    const url = 'https://example.com/policy'

    for (let count = 1; count <= 4; count++) {
      expect(await api.get(url)).toEqual({ count })
    }
    expect(await api.get(url, { headers: { 'cache-control': 'no-cache' } }))
      .toEqual({ count: 5 })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('honors explicit Fetch policy and integrity options', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(fetchMock.mock.calls.length)))
    vi.stubGlobal('fetch', fetchMock)
    const api = createClient({
      fetchOptions: { credentials: 'omit' },
      extensions: { memoryCache: { enabled: true } }
    }).use(memoryCachePlugin())
    const url = 'https://example.com/fetch-policy'

    expect(await api.get(url)).toEqual({ count: 1 })
    const policies: RequestInit[] = [
      { cache: 'no-store' },
      { cache: 'reload' },
      { integrity: 'sha256-invalid' },
      { redirect: 'error' },
      { mode: 'same-origin' },
      { referrer: 'https://example.com/other' },
      { referrerPolicy: 'no-referrer' }
    ]

    for (const [index, fetchOptions] of policies.entries()) {
      expect(await api.get(url, { fetchOptions }))
        .toEqual({ count: index + 2 })
    }

    expect(await api.get(url)).toEqual({ count: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(policies.length + 1)
  })

  it('does not persist partial-content responses', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(new Response(
        JSON.stringify({ count: fetchMock.mock.calls.length }),
        { status: fetchMock.mock.calls.length === 1 ? 206 : 200,
          headers: { 'content-type': 'application/json' } }
      )))
    vi.stubGlobal('fetch', fetchMock)
    const api = createClient({
      fetchOptions: { credentials: 'omit' },
      extensions: { memoryCache: { enabled: true } }
    }).use(memoryCachePlugin())
    const url = 'https://example.com/partial'

    expect(await api.get(url)).toEqual({ count: 1 })
    expect(await api.get(url)).toEqual({ count: 2 })
    expect(await api.get(url)).toEqual({ count: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns independent data and complete raw responses', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(1)))
    vi.stubGlobal('fetch', fetchMock)
    const api = createClient({ fetchOptions: { credentials: 'omit' },
      extensions: { memoryCache: { enabled: true } }
    }).use(memoryCachePlugin())
    const url = 'https://example.com/raw'

    const first = await api.get<{ count: number }>(url)
    first.count = 99
    const second = await api.get<{ count: number }>(url)
    expect(second).toEqual({ count: 1 })

    const complete = await api.getResponse<{ count: number }>(url)
    expect(complete.data).toEqual({ count: 1 })
    expect(await complete.raw.text()).toBe('{"count":1}')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const next = await api.getResponse<{ count: number }>(url)
    expect(await next.raw.text()).toBe('{"count":1}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid options and conflicting cache plugins', () => {
    expect(() => memoryCachePlugin({ maxEntries: 0 })).toThrow()
    expect(() => createClient().use(memoryCachePlugin()).use(cachePlugin()))
      .toThrow()
  })
})
