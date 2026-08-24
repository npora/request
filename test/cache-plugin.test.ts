import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CacheEntry, CacheStore, Plugin } from '../src'
import {
  cachePlugin,
  createClient,
  MemoryCacheStore,
  retryPlugin
} from '../src'

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cachePlugin', () => {
  it('should abort while an asynchronous cache read is pending', async () => {
    const store: CacheStore = {
      get: vi.fn(() => new Promise<CacheEntry | undefined>(() => {})),
      set() {},
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))
    const controller = new AbortController()
    const pending = request.get('/pending-cache-read', {
      signal: controller.signal,
      extensions: {
        cache: { enabled: true }
      }
    }).catch(error => error)

    await vi.waitFor(() => {
      expect(store.get).toHaveBeenCalledTimes(1)
    })

    controller.abort('cancel cache read')

    const outcome = await Promise.race([
      pending,
      new Promise<'still-pending'>(resolve => {
        setTimeout(() => resolve('still-pending'), 25)
      })
    ])

    expect(outcome).toMatchObject({ code: 'ABORT_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should abort while an asynchronous cache write is pending', async () => {
    const store: CacheStore = {
      get() {
        return undefined
      },
      set: vi.fn(() => new Promise<void>(() => {})),
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ ok: true })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))
    const controller = new AbortController()
    const pending = request.get('/pending-cache-write', {
      signal: controller.signal,
      extensions: {
        cache: { enabled: true, ttl: 1000 }
      }
    }).catch(error => error)

    await vi.waitFor(() => {
      expect(store.set).toHaveBeenCalledTimes(1)
    })

    controller.abort('cancel cache write')

    const outcome = await Promise.race([
      pending,
      new Promise<'still-pending'>(resolve => {
        setTimeout(() => resolve('still-pending'), 25)
      })
    ])

    expect(outcome).toMatchObject({ code: 'ABORT_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should evict the least recently used memory entry at capacity', () => {
    const store = new MemoryCacheStore({
      maxEntries: 2
    })
    const createEntry = (value: string) => ({
      data: value,
      expiresAt: Date.now() + 1000,
      status: 200,
      statusText: 'OK',
      headers: [] as [string, string][]
    })

    store.set('first', createEntry('first'))
    store.set('second', createEntry('second'))
    expect(store.get('first')?.data).toBe('first')

    store.set('third', createEntry('third'))

    expect(store.get('second')).toBeUndefined()
    expect(store.get('first')?.data).toBe('first')
    expect(store.get('third')?.data).toBe('third')
  })

  it('should remove expired memory entries when they are read', () => {
    vi.useFakeTimers()

    const store = new MemoryCacheStore()

    store.set('temporary', {
      data: true,
      expiresAt: Date.now() + 100,
      status: 200,
      statusText: 'OK',
      headers: []
    })

    vi.advanceTimersByTime(100)

    expect(store.get('temporary')).toBeUndefined()
  })

  it('should retain memory entries with no expiration', () => {
    const store = new MemoryCacheStore()

    store.set('permanent', {
      data: true,
      expiresAt: Number.POSITIVE_INFINITY,
      status: 200,
      statusText: 'OK',
      headers: []
    })

    expect(store.get('permanent')?.data).toBe(true)
  })

  it('should allow the default memory cache to be disabled', () => {
    const store = new MemoryCacheStore({
      maxEntries: 0
    })

    store.set('ignored', {
      data: true,
      expiresAt: Date.now() + 1000,
      status: 200,
      statusText: 'OK',
      headers: []
    })

    expect(store.get('ignored')).toBeUndefined()
  })

  it('should cache response when cache is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ name: 'Npora' }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 1000
        }
      }
    }

    const first = await request.get('/user', config)
    const second = await request.get('/user', config)

    expect(first).toEqual({ name: 'Npora' })
    expect(second).toEqual({ name: 'Npora' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not persist responses marked as no-store', async () => {
    const createResponse = (version: number) => {
      return new Response(JSON.stringify({ version }), {
        status: 200,
        headers: {
          'cache-control': 'public, no-store',
          'content-type': 'application/json'
        }
      })
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(1))
      .mockResolvedValueOnce(createResponse(2))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 1
    })
    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not persist responses with a wildcard vary header', async () => {
    const createResponse = (version: number) => {
      return new Response(JSON.stringify({ version }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          vary: '*'
        }
      })
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(1))
      .mockResolvedValueOnce(createResponse(2))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 1
    })
    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should read cache options from extensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        name: 'Npora'
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 1000
        }
      }
    }

    await request.get('/user', config)
    await request.get('/user', config)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not cache response when cache is disabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ name: 'Npora' }))
      .mockResolvedValueOnce(createJsonResponse({ name: 'Npora' }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    await request.get('/user')
    await request.get('/user')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should expire cache after ttl', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ version: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ version: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 100
        }
      }
    }

    const first = await request.get('/user', config)

    vi.advanceTimersByTime(100)

    const second = await request.get('/user', config)

    expect(first).toEqual({ version: 1 })
    expect(second).toEqual({ version: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should cache indefinitely when ttl is Infinity', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ version: 1 })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Number.POSITIVE_INFINITY
        }
      }
    }

    await expect(request.get('/permanent', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000)

    await expect(request.get('/permanent', config)).resolves.toEqual({
      version: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    -1
  ])('should reject invalid cache ttl %s before sending', async ttl => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    await expect(
      request.get('/invalid-ttl', {
        extensions: {
          cache: {
            enabled: true,
            ttl
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Cache ttl must be a non-negative finite number or Infinity'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should not extend ttl when a cached response is read', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ version: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ version: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 100
        }
      }
    }

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(90)

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(10)

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should use custom cache key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    await request.get('/user/1', {
      extensions: {
        cache: {
          enabled: true,
          key: 'user'
        }
      }
    })

    await request.get('/user/2', {
      extensions: {
        cache: {
          enabled: true,
          key: 'user'
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should preserve the default headerless cache key', async () => {
    const capturedKeys: string[] = []
    const store: CacheStore = {
      get(key) {
        capturedKeys.push(key)
        return undefined
      },
      set() {},
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(createJsonResponse({ ok: true }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))

    await request.get('/headerless', {
      extensions: {
        cache: {
          enabled: true
        }
      }
    })
    await request.get('/headerless', {
      extensions: {
        cache: {
          enabled: true
        }
      }
    })
    await request.get('/other', {
      extensions: {
        cache: {
          enabled: true
        }
      }
    })
    await request.get('/other', {
      extensions: {
        cache: {
          enabled: true
        }
      },
      responseType: 'text'
    })

    expect(capturedKeys[0]).toBe(JSON.stringify({
      method: 'GET',
      url: '/headerless',
      query: [],
      responseType: 'auto',
      headers: [
        ['accept', null],
        ['accept-language', null],
        ['authorization', null],
        ['cookie', null]
      ]
    }))
    expect(capturedKeys[1]).toBe(capturedKeys[0])
    expect(capturedKeys[2]).not.toBe(capturedKeys[1])
    expect(capturedKeys[3]).not.toBe(capturedKeys[2])
  })

  it('should persist a deduplicated miss under its request cache key', async () => {
    const readKeys: string[] = []
    const writtenKeys: string[] = []
    const store: CacheStore = {
      get(key) {
        readKeys.push(key)
        return undefined
      },
      set(key) {
        writtenKeys.push(key)
      },
      delete() {},
      clear() {}
    }
    const changeCacheKey: Plugin = {
      name: 'change-cache-key',
      install({ hooks }) {
        hooks.onTransport(context => {
          const cache = context.config.extensions?.cache

          if (cache) {
            cache.key = 'response-key'
          }
        })
      }
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ ok: true })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(cachePlugin({ store }))
      .use(changeCacheKey)

    await request.get('/stable-key', {
      extensions: {
        cache: {
          enabled: true,
          key: 'request-key'
        }
      }
    })

    expect(readKeys).toEqual(['request-key'])
    expect(writtenKeys).toEqual(['request-key'])
  })

  it('should normalize query key order in the default cache key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }

    await request.get('/search', {
      extensions: {
        cache
      },
      query: {
        page: 1,
        keyword: 'npora'
      }
    })
    await request.get('/search', {
      extensions: {
        cache
      },
      query: {
        keyword: 'npora',
        page: 1
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should preserve native searchParams entry order in cache keys', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(createJsonResponse({ ok: true }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = { enabled: true }

    await request.get('/search', {
      extensions: { cache },
      searchParams: new URLSearchParams([
        ['tag', 'first'],
        ['tag', 'second']
      ])
    })
    await request.get('/search', {
      extensions: { cache },
      searchParams: new URLSearchParams([
        ['tag', 'first'],
        ['tag', 'second']
      ])
    })
    await request.get('/search', {
      extensions: { cache },
      searchParams: new URLSearchParams([
        ['tag', 'second'],
        ['tag', 'first']
      ])
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should isolate cached data by response type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Npora', {
          status: 200,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode('Npora'), {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }
    const text = await request.get<string>('/document', {
      extensions: {
        cache
      },
      responseType: 'text'
    })
    const buffer = await request.get<ArrayBuffer>('/document', {
      extensions: {
        cache
      },
      responseType: 'arrayBuffer'
    })

    expect(text).toBe('Npora')
    expect(new TextDecoder().decode(buffer)).toBe('Npora')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should reuse immutable cached values without structured cloning', async () => {
    const cloneSpy = vi.fn(globalThis.structuredClone)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Npora', {
        headers: {
          'content-type': 'text/plain'
        }
      })
    )

    vi.stubGlobal('structuredClone', cloneSpy)
    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      },
      responseType: 'text' as const
    }

    await expect(request.get('/document', config)).resolves.toBe('Npora')
    await expect(request.get('/document', config)).resolves.toBe('Npora')

    expect(cloneSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not preserve a raw body for data-only cache requests', async () => {
    const response = createJsonResponse({ ok: true })
    const clone = vi.spyOn(response, 'clone')
    const fetchMock = vi.fn().mockResolvedValue(response)

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await expect(request.get('/data', config)).resolves.toEqual({ ok: true })
    await expect(request.get('/data', config)).resolves.toEqual({ ok: true })

    expect(clone).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should preserve independent raw bodies for complete cached responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ ok: true })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }
    const first = await request.getResponse('/data', config)
    const second = await request.getResponse('/data', config)

    await expect(first.raw.json()).resolves.toEqual({ ok: true })
    await expect(second.raw.json()).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should refetch a rawless data cache entry for a complete response', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(createJsonResponse({ payload: 'cached' }))
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await expect(request.get('/mixed-mode', config)).resolves.toEqual({
      payload: 'cached'
    })

    const response = await request.getResponse('/mixed-mode', config)

    await expect(response.raw.json()).resolves.toEqual({
      payload: 'cached'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not share or overwrite raw across mixed-mode requests', async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolvers.push(resolve)
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const dataOnly = request.get<{ source: string }>('/mixed-flight', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const complete = request.getResponse<{ source: string }>(
      '/mixed-flight',
      config
    )

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const completeFollower = request.getResponse<{ source: string }>(
      '/mixed-flight',
      config
    )

    resolvers[1]?.(createJsonResponse({ source: 'complete' }))
    const [completeResponse, followerResponse] = await Promise.all([
      complete,
      completeFollower
    ])

    resolvers[0]?.(createJsonResponse({ source: 'data' }))
    await expect(dataOnly).resolves.toEqual({ source: 'data' })
    await expect(completeResponse.raw.json()).resolves.toEqual({
      source: 'complete'
    })
    await expect(followerResponse.raw.json()).resolves.toEqual({
      source: 'complete'
    })

    const cached = await request.getResponse<{ source: string }>(
      '/mixed-flight',
      config
    )

    expect(cached.data).toEqual({ source: 'complete' })
    await expect(cached.raw.json()).resolves.toEqual({
      source: 'complete'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should share a complete leader with a data-only follower', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const complete = request.getResponse<{ value: number }>(
      '/complete-leader',
      config
    )

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const dataOnly = request.get<{ value: number }>(
      '/complete-leader',
      config
    )

    resolveFetch(createJsonResponse({ value: 1 }))

    const [response, data] = await Promise.all([complete, dataOnly])

    expect(data).toEqual({ value: 1 })
    await expect(response.raw.json()).resolves.toEqual({ value: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should deduplicate complete followers beside a rawless leader', async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolvers.push(resolve)
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 0
        }
      }
    }
    const dataOnly = request.get('/rawless-leader', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const first = request.getResponse('/rawless-leader', config)
    const second = request.getResponse('/rawless-leader', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    resolvers[1]?.(createJsonResponse({ mode: 'complete' }))
    const [firstResponse, secondResponse] = await Promise.all([first, second])

    await expect(firstResponse.raw.json()).resolves.toEqual({
      mode: 'complete'
    })
    await expect(secondResponse.raw.json()).resolves.toEqual({
      mode: 'complete'
    })

    resolvers[0]?.(createJsonResponse({ mode: 'data' }))
    await expect(dataOnly).resolves.toEqual({ mode: 'data' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should retain a rawless entry when its complete refetch fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ stale: false }))
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await request.get('/rawless-fallback', config)
    await expect(
      request.getResponse('/rawless-fallback', config)
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    await expect(request.get('/rawless-fallback', config)).resolves.toEqual({
      stale: false
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should store raw bodies only when the caller can observe them', async () => {
    let stored: CacheEntry | undefined
    const store: CacheStore = {
      get() {
        return undefined
      },
      set(_key, entry) {
        stored = entry
      },
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(createJsonResponse({ payload: 'cached' }))
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await request.get('/data-only', config)
    expect(stored?.raw).toBeUndefined()

    await request.getResponse('/complete', config)
    expect(stored?.raw).toBeInstanceOf(Response)
    await expect(stored?.raw?.json()).resolves.toEqual({ payload: 'cached' })
  })

  it('should skip cache snapshots for an unshared non-persistent miss', async () => {
    const cloneSpy = vi.fn(globalThis.structuredClone)
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ ok: true })
    )

    vi.stubGlobal('structuredClone', cloneSpy)
    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    await expect(request.get('/transient', {
      extensions: {
        cache: {
          enabled: true,
          ttl: 0
        }
      }
    })).resolves.toEqual({ ok: true })

    expect(cloneSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should isolate cache stores between plugin instances', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ client: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ client: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const firstClient = createClient().use(cachePlugin())
    const secondClient = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await expect(firstClient.get('/user', config)).resolves.toEqual({
      client: 1
    })
    await expect(secondClient.get('/user', config)).resolves.toEqual({
      client: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should vary the default cache key by authorization header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ user: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ user: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }

    await expect(
      request.get('/profile', {
        extensions: {
          cache
        },
        headers: {
          authorization: 'Bearer token-1'
        }
      })
    ).resolves.toEqual({
      user: 1
    })

    await expect(
      request.get('/profile', {
        extensions: {
          cache
        },
        headers: {
          authorization: 'Bearer token-2'
        }
      })
    ).resolves.toEqual({
      user: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should vary cached responses by configured request headers', async () => {
    const createResponse = (tenant: number) => {
      return new Response(JSON.stringify({ tenant }), {
        headers: {
          'content-type': 'application/json',
          vary: 'x-tenant'
        }
      })
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(1))
      .mockResolvedValueOnce(createResponse(2))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }

    await expect(
      request.get('/profile', {
        extensions: { cache },
        headers: {
          'x-tenant': 'tenant-1'
        }
      })
    ).resolves.toEqual({ tenant: 1 })
    await expect(
      request.get('/profile', {
        extensions: { cache },
        headers: {
          'x-tenant': 'tenant-2'
        }
      })
    ).resolves.toEqual({ tenant: 2 })
    await expect(
      request.get('/profile', {
        extensions: { cache },
        headers: {
          'x-tenant': 'tenant-1'
        }
      })
    ).resolves.toEqual({ tenant: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not cache non-idempotent methods by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ order: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ order: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      },
      json: {
        item: 'book'
      }
    }

    await expect(request.post('/orders', config)).resolves.toEqual({
      order: 1
    })
    await expect(request.post('/orders', config)).resolves.toEqual({
      order: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should return independent copies of cached data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        profile: {
          name: 'Npora'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    const first = await request.get<{
      profile: {
        name: string
      }
    }>('/profile', config)

    first.profile.name = 'Changed'

    const second = await request.get<{
      profile: {
        name: string
      }
    }>('/profile', config)

    expect(second.profile.name).toBe('Npora')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should run response interceptors once for every cache result', async () => {
    const responseInterceptor = vi.fn(response => {
      const data = response.data as {
        value: number
      }

      return {
        ...response,
        data: {
          value: data.value + 1
        }
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        value: 0
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    request.interceptors.response.use(responseInterceptor)

    await expect(request.get('/value', config)).resolves.toEqual({
      value: 1
    })
    await expect(request.get('/value', config)).resolves.toEqual({
      value: 1
    })
    expect(responseInterceptor).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should run other response hooks for cache hits', async () => {
    const responseHook = vi.fn()
    const observer: Plugin = {
      name: 'cache-observer',
      install({ hooks }) {
        hooks.onResponse(responseHook)
      }
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(cachePlugin())
      .use(observer)
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await request.get('/observed', config)
    await request.get('/observed', config)

    expect(responseHook).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should clear one plugin cache instance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ version: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ version: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const plugin = cachePlugin()
    const request = createClient().use(plugin)
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await request.get('/version', config)
    plugin.clear()

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should isolate requests started after clear from an older shared request', async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolvers.push(resolve)
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const plugin = cachePlugin()
    const request = createClient().use(plugin)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const oldLeader = request.get('/clear-flight', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const oldFollower = request.get('/clear-flight', config)

    await Promise.resolve()
    plugin.clear()

    const current = request.get('/clear-flight', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    resolvers[1]?.(createJsonResponse({ generation: 'current' }))
    await expect(current).resolves.toEqual({ generation: 'current' })

    resolvers[0]?.(new Response(JSON.stringify({ generation: 'old' }), {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json'
      }
    }))
    await expect(oldLeader).resolves.toEqual({ generation: 'old' })
    await expect(oldFollower).resolves.toEqual({ generation: 'old' })

    await expect(request.get('/clear-flight', config)).resolves.toEqual({
      generation: 'current'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should settle complete-response followers detached by clear', async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolvers.push(resolve)
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const plugin = cachePlugin()
    const request = createClient().use(plugin)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const oldLeader = request.getResponse('/clear-complete', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const oldFollower = request.getResponse('/clear-complete', config)

    await Promise.resolve()
    plugin.clear()

    const current = request.getResponse('/clear-complete', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    resolvers[1]?.(createJsonResponse({ generation: 'current' }))
    const currentResponse = await current

    resolvers[0]?.(createJsonResponse({ generation: 'old' }))
    const [oldResponse, followerResponse] = await Promise.all([
      oldLeader,
      oldFollower
    ])

    await expect(currentResponse.raw.json()).resolves.toEqual({
      generation: 'current'
    })
    await expect(oldResponse.raw.json()).resolves.toEqual({
      generation: 'old'
    })
    await expect(followerResponse.raw.json()).resolves.toEqual({
      generation: 'old'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not repopulate the cache from an unshared request cleared in flight', async () => {
    let resolveFirst!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => {
        return new Promise<Response>(resolve => {
          resolveFirst = resolve
        })
      })
      .mockResolvedValueOnce(createJsonResponse({ generation: 'current' }))

    vi.stubGlobal('fetch', fetchMock)

    const plugin = cachePlugin({ dedupe: false })
    const request = createClient().use(plugin)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const oldRequest = request.get('/clear-unshared', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    plugin.clear()
    resolveFirst(createJsonResponse({ generation: 'old' }))

    await expect(oldRequest).resolves.toEqual({ generation: 'old' })
    await expect(request.get('/clear-unshared', config)).resolves.toEqual({
      generation: 'current'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should ignore a stale asynchronous cache read after clear', async () => {
    let resolveRead!: (entry: CacheEntry) => void
    const store: CacheStore = {
      get() {
        return new Promise<CacheEntry>(resolve => {
          resolveRead = resolve
        })
      },
      set() {},
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ generation: 'network' })
    )

    vi.stubGlobal('fetch', fetchMock)

    const plugin = cachePlugin({ store })
    const request = createClient().use(plugin)
    const pending = request.get('/clear-read', {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    })

    await vi.waitFor(() => {
      expect(resolveRead).toBeTypeOf('function')
    })

    plugin.clear()
    resolveRead({
      data: { generation: 'stale' },
      expiresAt: Infinity,
      status: 200,
      statusText: 'OK',
      headers: []
    })

    await expect(pending).resolves.toEqual({ generation: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should deduplicate concurrent equivalent requests', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 0
        }
      }
    }
    const first = request.get<{ value: number }>('/shared', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const second = request.get<{ value: number }>('/shared', config)
    const third = request.get<{ value: number }>('/shared', config)

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(createJsonResponse({ value: 1 }))

    const [firstData, secondData, thirdData] = await Promise.all([
      first,
      second,
      third
    ])

    firstData.value = 2

    expect(secondData).toEqual({
      value: 1
    })
    expect(thirdData).toEqual({
      value: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not cache or share automatically detected streaming responses', async () => {
    let version = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      version += 1

      return Promise.resolve(
        new Response(`{"version":${version}}\n`, {
          headers: {
            'content-type': 'application/x-ndjson'
          }
        })
      )
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }
    const [first, second] = await Promise.all([
      request.get<AsyncIterable<{ version: number }>>('/stream', config),
      request.get<AsyncIterable<{ version: number }>>('/stream', config)
    ])
    const firstValues = []
    const secondValues = []

    for await (const value of first) {
      firstValues.push(value)
    }

    for await (const value of second) {
      secondValues.push(value)
    }

    expect(firstValues).toEqual([{ version: 1 }])
    expect(secondValues).toEqual([{ version: 2 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should allow disabling request deduplication', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(createJsonResponse({
        ok: true
      }))
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          dedupe: false
        }
      }
    }

    await Promise.all([
      request.get('/shared', config),
      request.get('/shared', config)
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should keep followers pending while the leader retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(cachePlugin())
      .use(
        retryPlugin({
          retries: 1,
          delay: 0
        })
      )
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    const [first, second] = await Promise.all([
      request.get('/retry-shared', config),
      request.get('/retry-shared', config)
    ])

    expect(first).toEqual({
      ok: true
    })
    expect(second).toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should release followers with the final shared error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error('network down')
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }
    const results = await Promise.allSettled([
      request.get('/failed-shared', config),
      request.get('/failed-shared', config)
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(2)

    for (const result of results) {
      expect(result.status).toBe('rejected')

      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({
          code: 'NETWORK_ERROR',
          message: 'Network request failed'
        })
      }
    }
  })

  it('should abort one follower without cancelling the leader', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }
    const leader = request.get('/abort-shared', {
      extensions: {
        cache
      }
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const controller = new AbortController()
    const follower = request.get('/abort-shared', {
      signal: controller.signal,
      extensions: {
        cache
      }
    })

    controller.abort('follower cancelled')

    await expect(follower).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })

    resolveFetch(createJsonResponse({ ok: true }))

    await expect(leader).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not subscribe after synchronous follower abort registration', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })
    const reason = new Error('synchronous follower abort')
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      reason,
      addEventListener(_type: string, listener: EventListener) {
        this.aborted = true
        listener(new Event('abort'))
      },
      removeEventListener
    } as unknown as AbortSignal

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true
      }
    }
    const leader = request.get('/sync-abort-shared', { extensions })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const follower = request.get('/sync-abort-shared', {
      signal,
      extensions
    })

    await expect(follower).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })
    expect(removeEventListener).toHaveBeenCalledTimes(1)

    resolveFetch(createJsonResponse({ ok: true }))
    await expect(leader).resolves.toEqual({ ok: true })
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('should release a follower when listener cleanup throws', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })
    const removeEventListener = vi.fn(() => {
      throw new Error('listener cleanup failed')
    })
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener
    } as unknown as AbortSignal

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true
      }
    }
    const leader = request.get('/cleanup-shared', { extensions })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const follower = request.get('/cleanup-shared', {
      signal,
      extensions
    })

    resolveFetch(createJsonResponse({ ok: true }))

    await expect(leader).resolves.toEqual({ ok: true })
    await expect(follower).resolves.toEqual({ ok: true })
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('should clean up when follower abort listener setup fails', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      addEventListener() {
        throw new Error('listener setup failed')
      },
      removeEventListener
    } as unknown as AbortSignal

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true
      }
    }
    const leader = request.get('/listener-failure-shared', { extensions })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const follower = request.get('/listener-failure-shared', {
      signal,
      extensions
    })

    await expect(follower).rejects.toThrow('listener setup failed')
    expect(removeEventListener).toHaveBeenCalledTimes(1)

    resolveFetch(createJsonResponse({ ok: true }))
    await expect(leader).resolves.toEqual({ ok: true })
  })

  it('should share a custom cache store between plugin instances', async () => {
    const store = new MemoryCacheStore()
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        shared: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const firstClient = createClient().use(
      cachePlugin({
        store
      })
    )
    const secondClient = createClient().use(
      cachePlugin({
        store
      })
    )
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await firstClient.get('/stored', config)

    await expect(
      secondClient.get('/stored', config)
    ).resolves.toEqual({
      shared: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should isolate network requests from cache store failures', async () => {
    const store: CacheStore = {
      get: vi.fn().mockRejectedValue(new Error('get failed')),
      set: vi.fn().mockRejectedValue(new Error('set failed')),
      delete: vi.fn().mockRejectedValue(new Error('delete failed')),
      clear: vi.fn()
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      cachePlugin({
        store
      })
    )

    await expect(
      request.get('/store-failure', {
        extensions: {
          cache: {
            enabled: true
          }
        }
      })
    ).resolves.toEqual({
      ok: true
    })
  })

  it('should delete malformed external cache entries and fetch normally', async () => {
    const remove = vi.fn()
    const store: CacheStore = {
      get() {
        return {
          data: {
            stale: true
          },
          expiresAt: Date.now() + 1000,
          status: 999,
          statusText: 'Invalid',
          headers: []
        }
      },
      set() {},
      delete: remove,
      clear() {}
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        fresh: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      cachePlugin({
        store
      })
    )

    await expect(
      request.get('/malformed', {
        extensions: {
          cache: {
            enabled: true
          }
        }
      })
    ).resolves.toEqual({
      fresh: true
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should release followers when the cache plugin is removed', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(() => {})
    })

    vi.stubGlobal('fetch', fetchMock)

    const store = new MemoryCacheStore()
    const read = vi.spyOn(store, 'get')
    const cache = cachePlugin({
      store
    })
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    void request.get('/removed-cache', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const follower = request.get('/removed-cache', config)

    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
    })
    await Promise.resolve()
    request.unuse('cache')

    await expect(follower).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Cache plugin removed during shared request'
    })
  })

  it('should not create shared state after removal during an async read', async () => {
    let resolveRead!: () => void
    const store: CacheStore = {
      get() {
        return new Promise<undefined>(resolve => {
          resolveRead = () => resolve(undefined)
        })
      },
      set() {},
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({
      store
    })
    const request = createClient().use(cache)
    const pending = request.get('/remove-during-read', {
      extensions: {
        cache: {
          enabled: true
        }
      }
    })

    await vi.waitFor(() => {
      expect(resolveRead).toBeTypeOf('function')
    })

    request.unuse('cache')
    resolveRead()

    await expect(pending).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
