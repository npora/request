import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Adapter,
  CacheEntry,
  CacheEvent,
  CacheStore,
  Plugin
} from '../src'
import {
  cachePlugin,
  createClient,
  IndexedDBCacheStore,
  MemoryCacheStore,
  retryPlugin,
  WebStorageCacheStore
} from '../src'

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function createWebStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cachePlugin', () => {
  it('should normalize equivalent URL objects to one cache key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"source":"network"}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 60000
        }
      }
    }

    await request.get(new URL('https://api.example.com/users'), config)
    await expect(request.get(
      new URL('https://api.example.com/users'),
      config
    )).resolves.toEqual({ source: 'network' })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

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

  it('should retain expired memory entries for revalidation', () => {
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

    expect(store.get('temporary')?.data).toBe(true)
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

  it('should persist portable entries across web storage instances', () => {
    const storage = createWebStorage()
    const first = new WebStorageCacheStore(storage, {
      namespace: 'persistent-test'
    })

    first.set('profile', {
      data: { name: 'Npora' },
      expiresAt: Infinity,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      tags: ['profile'],
      raw: createJsonResponse({ name: 'Npora' })
    })

    const restored = new WebStorageCacheStore(storage, {
      namespace: 'persistent-test'
    }).get('profile')

    expect(restored).toMatchObject({
      data: { name: 'Npora' },
      expiresAt: Infinity,
      status: 200,
      tags: ['profile']
    })
    expect(restored?.raw).toBeUndefined()
  })

  it('should isolate web storage clearing and tags by namespace', () => {
    const storage = createWebStorage()
    const first = new WebStorageCacheStore(storage, { namespace: 'first' })
    const second = new WebStorageCacheStore(storage, { namespace: 'second' })
    const entry: CacheEntry = {
      data: true,
      expiresAt: Infinity,
      status: 200,
      statusText: 'OK',
      headers: [],
      tags: ['shared-tag']
    }

    first.set('entry', entry)
    second.set('entry', entry)

    expect(first.invalidateTags(['shared-tag'])).toBe(1)
    expect(second.get('entry')?.data).toBe(true)

    first.set('entry', entry)
    first.clear()
    expect(first.get('entry')).toBeUndefined()
    expect(second.get('entry')?.data).toBe(true)
  })

  it('should evict least recently used web storage entries', () => {
    vi.useFakeTimers()

    const storage = createWebStorage()
    const store = new WebStorageCacheStore(storage, {
      namespace: 'lru',
      maxEntries: 2
    })
    const entry = (data: string): CacheEntry => ({
      data,
      expiresAt: Infinity,
      status: 200,
      statusText: 'OK',
      headers: []
    })

    store.set('first', entry('first'))
    vi.advanceTimersByTime(1)
    store.set('second', entry('second'))
    vi.advanceTimersByTime(1)
    store.get('first')
    vi.advanceTimersByTime(1)
    store.set('third', entry('third'))

    expect(store.get('first')?.data).toBe('first')
    expect(store.get('second')).toBeUndefined()
    expect(store.get('third')?.data).toBe('third')
  })

  it('should remove malformed web storage entries', () => {
    const storage = createWebStorage()
    const store = new WebStorageCacheStore(storage, {
      namespace: 'malformed'
    })
    const key = '@npora/request:malformed:entry'

    storage.setItem(key, '{invalid json')

    expect(store.get('entry')).toBeUndefined()
    expect(storage.getItem(key)).toBeNull()
  })

  it('should validate IndexedDB cache schema versions', () => {
    const factory = {} as IDBFactory

    expect(() => new IndexedDBCacheStore(factory, {
      schemaVersion: 0
    })).toThrow(/schemaVersion/)
    expect(() => new IndexedDBCacheStore(factory, {
      schemaVersion: 1.5
    })).toThrow(/schemaVersion/)
    expect(() => new IndexedDBCacheStore(factory, {
      schemaVersion: 2
    })).not.toThrow()
    expect(() => new IndexedDBCacheStore(factory, {
      maxBytes: -1
    })).toThrow(/maxBytes/)
    expect(() => new IndexedDBCacheStore(factory, {
      maxBytes: 1024,
      quotaRecovery: false
    })).not.toThrow()
    expect(() => new IndexedDBCacheStore(factory, {
      // @ts-expect-error Verifies runtime validation for JavaScript callers.
      onEvent: true
    })).toThrow(/onEvent/)
    expect(() => new IndexedDBCacheStore(factory, {
      // @ts-expect-error Verifies runtime validation for JavaScript callers.
      shouldPersist: true
    })).toThrow(/shouldPersist/)
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

  it('should not reuse responses marked as no-cache without revalidation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'public, no-cache',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'public, no-cache',
          'content-type': 'application/json'
        }
      }))

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

    await expect(request.get('/no-cache', config)).resolves.toEqual({
      version: 1
    })
    await expect(request.get('/no-cache', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should revalidate an expired ETag response and refresh its ttl', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1',
          'content-type': 'application/json',
          etag: '"version-1"',
          'x-version': 'original'
        }
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: {
          'cache-control': 'max-age=10',
          etag: '"version-1"',
          'x-version': 'revalidated'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      throwHttpErrors: false,
      extensions: {
        cache: {
          enabled: true,
          ttl: 30000
        }
      }
    }

    await expect(request.getResponse('/etag', config)).resolves.toMatchObject({
      data: { version: 1 }
    })
    vi.advanceTimersByTime(1000)

    const revalidated = await request.getResponse('/etag', config)

    expect(revalidated.data).toEqual({ version: 1 })
    expect(revalidated.status).toBe(200)
    expect(revalidated.headers.get('x-version')).toBe('revalidated')
    expect(revalidated.raw.headers.get('x-version')).toBe('revalidated')
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')
    ).toBe('"version-1"')

    vi.advanceTimersByTime(9999)
    await expect(request.get('/etag', config)).resolves.toEqual({
      version: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should revalidate no-cache responses with Last-Modified every time', async () => {
    const lastModified = 'Tue, 25 Aug 2026 00:00:00 GMT'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'last-modified': lastModified
        }
      }))
      .mockResolvedValue(new Response(null, {
        status: 304,
        headers: {
          'cache-control': 'no-cache',
          'last-modified': lastModified
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/last-modified', config)
    await request.get('/last-modified', config)
    await expect(request.get('/last-modified', config)).resolves.toEqual({
      version: 1
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
        .get('if-modified-since')
    ).toBe(lastModified)
  })

  it('should replace a stale validator entry when the entity changed', async () => {
    vi.useFakeTimers()

    const createResponse = (version: number) => {
      return new Response(JSON.stringify({ version }), {
        headers: {
          'cache-control': 'max-age=1',
          'content-type': 'application/json',
          etag: `"version-${version}"`
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
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/changed', config)
    vi.advanceTimersByTime(1000)
    await expect(request.get('/changed', config)).resolves.toEqual({
      version: 2
    })
    await expect(request.get('/changed', config)).resolves.toEqual({
      version: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not override application conditional request headers', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('{"ok":true}', {
        headers: {
          'cache-control': 'max-age=1',
          'content-type': 'application/json',
          etag: '"stored"'
        }
      }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true,
        key: 'user-condition',
        ttl: 10000
      }
    }

    await request.get('/user-condition', { extensions })
    vi.advanceTimersByTime(1000)
    await request.get('/user-condition', {
      extensions,
      headers: {
        'if-none-match': '"application"'
      }
    })

    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')
    ).toBe('"application"')
  })

  it.each([
    'no-cache',
    'max-age=0'
  ])('should force ETag revalidation for request Cache-Control: %s', async directive => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json',
          etag: '"version-1"'
        }
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: {
          'cache-control': 'max-age=60',
          etag: '"version-1"'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true,
        ttl: 60000
      }
    }

    await request.get('/request-revalidation', { extensions })
    await expect(request.get('/request-revalidation', {
      extensions,
      headers: {
        'cache-control': directive
      }
    })).resolves.toEqual({ version: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')
    ).toBe('"version-1"')
  })

  it('should support Pragma no-cache when Cache-Control is absent', async () => {
    const lastModified = 'Tue, 25 Aug 2026 00:00:00 GMT'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json',
          'last-modified': lastModified
        }
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: {
          'cache-control': 'max-age=60',
          'last-modified': lastModified
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true,
        ttl: 60000
      }
    }

    await request.get('/pragma-revalidation', { extensions })
    await request.get('/pragma-revalidation', {
      extensions,
      headers: {
        pragma: 'no-cache'
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
        .get('if-modified-since')
    ).toBe(lastModified)
  })

  it('should bypass cache reads, writes and dedupe for request no-store', async () => {
    const createResponse = (version: number) => {
      return new Response(JSON.stringify({ version }), {
        headers: {
          'cache-control': 'max-age=60',
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
    const extensions = {
      cache: {
        enabled: true,
        ttl: 60000
      }
    }

    await request.get('/request-no-store', { extensions })
    await expect(request.get('/request-no-store', {
      extensions,
      headers: {
        'cache-control': 'no-store'
      }
    })).resolves.toEqual({ version: 2 })
    await expect(request.get('/request-no-store', { extensions }))
      .resolves.toEqual({ version: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no-cors', { mode: 'no-cors' }],
    ['manual redirect', { redirect: 'manual' }]
  ] as const)(
    'should bypass cache reads, writes and dedupe for %s requests',
    async (_label, fetchOptions) => {
      const fetchMock = vi.fn().mockImplementation(() => {
        const response = new Response(null)

        Object.defineProperties(response, {
          status: {
            configurable: true,
            value: 0
          },
          type: {
            configurable: true,
            value: fetchOptions.mode === 'no-cors'
              ? 'opaque'
              : 'opaqueredirect'
          }
        })

        return Promise.resolve(response)
      })

      vi.stubGlobal('fetch', fetchMock)

      const request = createClient().use(cachePlugin())
      const config = {
        fetchOptions,
        extensions: {
          cache: {
            enabled: true,
            ttl: 60000
          }
        }
      }

      await expect(request.get('/filtered-response', config))
        .resolves.toBeUndefined()
      await expect(request.get('/filtered-response', config))
        .resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it('should not store an opaque response returned by custom Fetch', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const response = new Response(null)

      Object.defineProperties(response, {
        status: {
          configurable: true,
          value: 0
        },
        type: {
          configurable: true,
          value: 'opaque'
        }
      })

      return Promise.resolve(response)
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 60000
        }
      }
    }

    await expect(request.get('/custom-opaque', config))
      .resolves.toBeUndefined()
    await expect(request.get('/custom-opaque', config))
      .resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should replace a fresh entry when forced revalidation has no validator', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true,
        ttl: 60000
      }
    }

    await request.get('/forced-refresh', { extensions })
    await expect(request.get('/forced-refresh', {
      extensions,
      headers: {
        'cache-control': 'no-cache'
      }
    })).resolves.toEqual({ version: 2 })
    await expect(request.get('/forced-refresh', { extensions }))
      .resolves.toEqual({ version: 2 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    'Cache-Control',
    'Pragma'
  ])('should not persist responses varying on request control header %s', async vary => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('{"ok":true}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json',
          vary
        }
      }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 60000
        }
      }
    }

    await request.get('/vary-request-control', config)
    await request.get('/vary-request-control', config)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should serve stale on a network error within the response window', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-if-error=5',
          'content-type': 'application/json'
        }
      }))
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/stale-network', config)
    vi.advanceTimersByTime(1000)

    await expect(request.get('/stale-network', config)).resolves.toEqual({
      version: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should allow an application stale-if-error window without a directive', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1',
          'content-type': 'application/json'
        }
      }))
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          staleIfError: 5000,
          ttl: 10000
        }
      }
    }

    await request.get('/configured-stale', config)
    vi.advanceTimersByTime(1000)

    await expect(request.get('/configured-stale', config)).resolves.toEqual({
      version: 1
    })
  })

  it('should cap the response stale window with the application limit', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-if-error=60',
          'content-type': 'application/json'
        }
      }))
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          staleIfError: 1000,
          ttl: 10000
        }
      }
    }

    await request.get('/capped-stale', config)
    vi.advanceTimersByTime(2000)

    await expect(request.get('/capped-stale', config))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it.each([
    'stale-if-error=invalid',
    'stale-if-error=5, stale-if-error=10'
  ])('should reject unsafe stale fallback directive %s', async cacheControl => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': `max-age=1, ${cacheControl}`,
          'content-type': 'application/json'
        }
      }))
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/unsafe-stale-directive', config)
    vi.advanceTimersByTime(1000)

    await expect(request.get('/unsafe-stale-directive', config))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('should use stale only after configured retries are exhausted', async () => {
    vi.useFakeTimers()

    const unavailable = () => new Response('Unavailable', { status: 503 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-if-error=5',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(cachePlugin())
      .use(retryPlugin({ retries: 1, delay: 0 }))
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/retry-stale', config)
    vi.advanceTimersByTime(1000)

    await expect(request.get('/retry-stale', config)).resolves.toEqual({
      version: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('should not use stale for parser, non-5xx HTTP or abort errors', async () => {
    vi.useFakeTimers()

    const responses = [
      new Response('not-json', {
        headers: { 'content-type': 'application/json' }
      }),
      new Response('Missing', { status: 404 })
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-if-error=60',
          'content-type': 'application/json',
          etag: '"strict"'
        }
      }))
      .mockImplementation(() => Promise.resolve(responses.shift()!))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/strict-stale', config)
    vi.advanceTimersByTime(1000)

    await expect(request.get('/strict-stale', config))
      .rejects.toMatchObject({ code: 'PARSER_ERROR' })
    await expect(request.get('/strict-stale', config))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404 })

    const controller = new AbortController()

    controller.abort('cancelled')
    await expect(request.get('/strict-stale', {
      ...config,
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('should validate staleIfError before reading or sending', async () => {
    const store = new MemoryCacheStore()
    const read = vi.spyOn(store, 'get')
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))

    await expect(request.get('/invalid-stale-window', {
      extensions: {
        cache: {
          enabled: true,
          staleIfError: -1
        }
      }
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(read).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should not share a leader stale fallback with waiting requests', async () => {
    vi.useFakeTimers()

    let rejectFailure!: (error: unknown) => void
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-if-error=5',
          'content-type': 'application/json'
        }
      }))
      .mockImplementationOnce(() => {
        return new Promise<Response>((_resolve, reject) => {
          rejectFailure = reject
        })
      })
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/stale-leader', config)
    vi.advanceTimersByTime(1000)

    const leader = request.get('/stale-leader', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const follower = request.get('/stale-leader', config)

    rejectFailure(new Error('offline'))

    await expect(leader).resolves.toEqual({ version: 1 })
    await expect(follower).resolves.toEqual({ version: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('should return stale immediately and refresh in the background', async () => {
    vi.useFakeTimers()

    let resolveRefresh!: (response: Response) => void
    const store = new MemoryCacheStore()
    const write = vi.spyOn(store, 'set')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=0, stale-while-revalidate=5',
          'content-type': 'application/json'
        }
      }))
      .mockImplementationOnce(() => {
        return new Promise<Response>(resolve => {
          resolveRefresh = resolve
        })
      })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/swr', config)
    await expect(request.get('/swr', config)).resolves.toEqual({
      version: 1
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    await expect(request.get('/swr', config)).resolves.toEqual({
      version: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveRefresh(new Response('{"version":2}', {
      headers: {
        'cache-control': 'max-age=60',
        'content-type': 'application/json'
      }
    }))

    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledTimes(2)
    })
    await expect(request.get('/swr', config)).resolves.toEqual({
      version: 2
    })
  })

  it('should support and cap an application stale-while-revalidate window', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-while-revalidate=60',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          staleWhileRevalidate: 1000,
          ttl: 10000
        }
      }
    }

    await request.get('/capped-swr', config)
    vi.advanceTimersByTime(2000)

    await expect(request.get('/capped-swr', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should enable stale-while-revalidate from application config', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          staleWhileRevalidate: 5000,
          ttl: 10000
        }
      }
    }

    await request.get('/configured-swr', config)
    vi.advanceTimersByTime(1000)
    await expect(request.get('/configured-swr', config)).resolves.toEqual({
      version: 1
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('should not use stale-while-revalidate for forced or must-revalidate requests', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=1, stale-while-revalidate=60',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=1, must-revalidate',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":3}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const extensions = {
      cache: {
        enabled: true,
        staleWhileRevalidate: 60000,
        ttl: 10000
      }
    }

    await request.get('/strict-swr', { extensions })
    vi.advanceTimersByTime(1000)
    await expect(request.get('/strict-swr', {
      extensions,
      headers: {
        'cache-control': 'no-cache'
      }
    })).resolves.toEqual({ version: 2 })

    vi.advanceTimersByTime(1000)
    await expect(request.get('/strict-swr', { extensions })).resolves.toEqual({
      version: 3
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    'stale-while-revalidate=invalid',
    'stale-while-revalidate=5, stale-while-revalidate=10'
  ])('should reject unsafe stale-while-revalidate directive %s', async cacheControl => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': `max-age=1, ${cacheControl}`,
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/unsafe-swr', config)
    vi.advanceTimersByTime(1000)
    await expect(request.get('/unsafe-swr', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should run each background refresh through request interceptors once', async () => {
    vi.useFakeTimers()

    const observedHeaders: string[] = []
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url, init) => {
        observedHeaders.push(new Headers(init?.headers).get('x-pass') ?? '')
        return Promise.resolve(new Response('{"version":1}', {
          headers: {
            'cache-control': 'max-age=0, stale-while-revalidate=5',
            'content-type': 'application/json'
          }
        }))
      })
      .mockImplementationOnce((_url, init) => {
        observedHeaders.push(new Headers(init?.headers).get('x-pass') ?? '')
        return Promise.resolve(new Response('{"version":2}', {
          headers: {
            'cache-control': 'max-age=60',
            'content-type': 'application/json'
          }
        }))
      })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    request.interceptors.request.use(config => {
      const headers = new Headers(config.headers)
      const previous = Number(headers.get('x-pass') ?? 0)

      headers.set('x-pass', String(previous + 1))
      return { ...config, headers }
    })

    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/intercepted-swr', config)
    await request.get('/intercepted-swr', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(observedHeaders).toEqual(['1', '1'])
  })

  it('should use the owning custom adapter for background refresh', async () => {
    let calls = 0
    const adapter: Adapter = {
      async request(config) {
        calls += 1
        const headers = new Headers({
          'cache-control': calls === 1
            ? 'max-age=0, stale-while-revalidate=5'
            : 'max-age=60',
          'content-type': 'application/json'
        })

        return {
          data: { version: calls },
          status: 200,
          statusText: 'OK',
          headers,
          config,
          raw: new Response(JSON.stringify({ version: calls }), { headers })
        }
      }
    }
    const request = createClient({ adapter }).use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/custom-adapter-swr', config)
    await expect(request.get('/custom-adapter-swr', config)).resolves.toEqual({
      version: 1
    })

    await vi.waitFor(() => {
      expect(calls).toBe(2)
    })
    await expect(request.get('/custom-adapter-swr', config)).resolves.toEqual({
      version: 2
    })
  })

  it.each([
    'clear',
    'remove'
  ])('should abort background refresh when cache is %s', async action => {
    let refreshSignal: AbortSignal | undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=0, stale-while-revalidate=5',
          'content-type': 'application/json'
        }
      }))
      .mockImplementationOnce((_url, init) => {
        refreshSignal = init?.signal ?? undefined

        return new Promise<Response>((_resolve, reject) => {
          refreshSignal?.addEventListener('abort', () => {
            reject(refreshSignal?.reason)
          }, { once: true })
        })
      })

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/abort-swr', config)
    await request.get('/abort-swr', config)

    await vi.waitFor(() => {
      expect(refreshSignal).toBeDefined()
    })

    if (action === 'clear') {
      await cache.clear()
    } else {
      request.unuse('cache')
    }

    expect(refreshSignal?.aborted).toBe(true)
  })

  it('should validate staleWhileRevalidate before cache reads', async () => {
    const store = new MemoryCacheStore()
    const read = vi.spyOn(store, 'get')
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))

    await expect(request.get('/invalid-swr-window', {
      extensions: {
        cache: {
          enabled: true,
          staleWhileRevalidate: Number.NaN
        }
      }
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(read).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should cap configured ttl with response max-age and Age', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          age: '1',
          'cache-control': 'public, MAX-AGE="3"',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(createJsonResponse({ version: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await expect(request.get('/max-age', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(1999)

    await expect(request.get('/max-age', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(1)

    await expect(request.get('/max-age', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not let max-age extend the configured ttl', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))
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

    await request.get('/local-cap', config)
    vi.advanceTimersByTime(100)
    await expect(request.get('/local-cap', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    'max-age=invalid',
    'max-age=10, max-age=20'
  ])('should not persist ambiguous cache freshness %s', async cacheControl => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('{"ok":true}', {
        headers: {
          'cache-control': cacheControl,
          'content-type': 'application/json'
        }
      }))
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

    await request.get('/ambiguous-freshness', config)
    await request.get('/ambiguous-freshness', config)

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

  it('should not vary cache keys by local request context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true,
      ttl: 1000
    }

    const first = await request.getResponse('/context-cache', {
      context: { traceId: 'first' },
      extensions: { cache }
    })
    const second = await request.getResponse('/context-cache', {
      context: { traceId: 'second' },
      extensions: { cache }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.config.context).toEqual({ traceId: 'first' })
    expect(second.config.context).toEqual({ traceId: 'second' })
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

  it('should not cache FormData responses', async () => {
    const boundary = 'npora-cache-boundary'
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="name"\r\n\r\n' +
      `Npora\r\n--${boundary}--\r\n`
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response(body, {
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`
        }
      }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      responseType: 'formData' as const,
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await expect(request.get<FormData>('/form-data', config)).resolves
      .toBeInstanceOf(FormData)
    await expect(request.get<FormData>('/form-data', config)).resolves
      .toBeInstanceOf(FormData)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not cache byte responses', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      responseType: 'bytes' as const,
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await expect(request.get<Uint8Array>('/bytes', config)).resolves
      .toBeInstanceOf(Uint8Array)
    await expect(request.get<Uint8Array>('/bytes', config)).resolves
      .toBeInstanceOf(Uint8Array)
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

  it('should delete only the matching cache entry', async () => {
    const events: string[] = []
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ resource: 'first', version: 1 })
      ))
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ resource: 'second', version: 1 })
      ))
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ resource: 'first', version: 2 })
      ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({
      onEvent(event) {
        events.push(event.type)
      }
    })
    const request = createClient().use(cache)
    const first = {
      url: '/delete-first',
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const second = {
      url: '/delete-second',
      extensions: first.extensions
    }

    await request.get(first.url, first)
    await request.get(second.url, second)
    await cache.delete(first)

    await expect(request.get(second.url, second)).resolves.toEqual({
      resource: 'second',
      version: 1
    })
    await expect(request.get(first.url, first)).resolves.toEqual({
      resource: 'first',
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(cache.getStats().invalidations).toBe(1)
    expect(events).toContain('invalidated')
  })

  it('should invalidate a custom key independently of the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ version: 1 })
      ))
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ version: 2 })
      ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const cacheOptions = {
      enabled: true,
      key: 'current-user',
      ttl: Infinity
    }

    await request.get('/profile', {
      extensions: { cache: cacheOptions }
    })
    await cache.delete({
      url: '/different-url',
      extensions: {
        cache: { key: 'current-user' }
      }
    })

    await expect(request.get('/profile', {
      extensions: { cache: cacheOptions }
    })).resolves.toEqual({ version: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should prevent an invalidated in-flight response from repopulating', async () => {
    const targetResolvers: Array<(response: Response) => void> = []
    let resolveOther!: (response: Response) => void
    const fetchMock = vi.fn((url: string | URL | Request) => {
      if (String(url).endsWith('/unrelated-flight')) {
        return new Promise<Response>(resolve => {
          resolveOther = resolve
        })
      }

      return new Promise<Response>(resolve => {
        targetResolvers.push(resolve)
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const extensions = {
      cache: {
        enabled: true,
        ttl: Infinity
      }
    }
    const targetConfig = {
      url: '/target-flight',
      extensions
    }
    const oldTarget = request.get(targetConfig.url, targetConfig)
    const otherLeader = request.get('/unrelated-flight', { extensions })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    await cache.delete(targetConfig)

    const currentTarget = request.get(targetConfig.url, targetConfig)
    const otherFollower = request.get('/unrelated-flight', { extensions })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    targetResolvers[1]?.(createJsonResponse({ generation: 'current' }))
    await expect(currentTarget).resolves.toEqual({ generation: 'current' })

    targetResolvers[0]?.(createJsonResponse({ generation: 'old' }))
    resolveOther(createJsonResponse({ generation: 'unrelated' }))

    await expect(oldTarget).resolves.toEqual({ generation: 'old' })
    await expect(Promise.all([otherLeader, otherFollower])).resolves.toEqual([
      { generation: 'unrelated' },
      { generation: 'unrelated' }
    ])
    await expect(
      request.get(targetConfig.url, targetConfig)
    ).resolves.toEqual({
      generation: 'current'
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('should wait for an asynchronous targeted deletion before reading', async () => {
    let finishDeletion!: () => void
    const store: CacheStore = {
      get: vi.fn(() => undefined),
      set() {},
      delete: vi.fn(() => new Promise<void>(resolve => {
        finishDeletion = resolve
      })),
      clear() {}
    }
    const fetchMock = vi.fn(() => Promise.resolve(
      createJsonResponse({ source: 'network' })
    ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({ store })
    const request = createClient().use(cache)
    const config = {
      url: '/async-delete',
      extensions: {
        cache: {
          enabled: true
        }
      }
    }
    const deletion = cache.delete(config)
    const pending = request.get(config.url, config)

    await Promise.resolve()
    expect(store.get).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    finishDeletion()
    await deletion

    await expect(pending).resolves.toEqual({ source: 'network' })
    expect(store.get).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should serialize repeated asynchronous deletions for one key', async () => {
    const resolvers: Array<() => void> = []
    const store: CacheStore = {
      get() {
        return undefined
      },
      set() {},
      delete: vi.fn(() => new Promise<void>(resolve => {
        resolvers.push(resolve)
      })),
      clear() {}
    }
    const cache = cachePlugin({ store })
    const config = { url: '/repeated-delete' }
    const first = cache.delete(config)
    const second = cache.delete(config)

    expect(store.delete).toHaveBeenCalledTimes(1)

    resolvers[0]?.()
    await vi.waitFor(() => {
      expect(store.delete).toHaveBeenCalledTimes(2)
    })

    resolvers[1]?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined
    ])
    expect(cache.getStats().invalidations).toBe(2)
  })

  it('should seed a tagged cache entry without a network request', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = {
      url: '/seeded-entry',
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await cache.set(config, { version: 1 }, {
      ttl: Infinity,
      tags: ['seeded']
    })

    await expect(request.get(config.url, config)).resolves.toEqual({
      version: 1
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cache.invalidateTags('seeded')).toBe(1)
  })

  it('should update and delete parsed cache values', async () => {
    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = {
      url: '/updated-entry',
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await cache.set(config, { count: 1 }, { ttl: Infinity })
    expect(await cache.update<{ count: number }>(config, value => ({
      count: value.count + 1
    }))).toBe(true)
    await expect(request.get(config.url, config)).resolves.toEqual({
      count: 2
    })
    expect(await cache.update(config, () => undefined)).toBe(true)
    expect(await cache.update(config, value => value)).toBe(false)
  })

  it('should prevent an older response from overwriting a seeded value', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => {
      resolveFetch = resolve
    }))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = {
      url: '/seed-during-flight',
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const oldRequest = request.get(config.url, config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    await cache.set(config, { source: 'seed' }, { ttl: Infinity })
    resolveFetch(createJsonResponse({ source: 'old-network' }))

    await expect(oldRequest).resolves.toEqual({ source: 'old-network' })
    await expect(request.get(config.url, config)).resolves.toEqual({
      source: 'seed'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should serialize manual writes and cache reads for one key', async () => {
    let finishWrite!: () => void
    let entry: CacheEntry | undefined
    const store: CacheStore = {
      get: vi.fn(() => entry),
      set: vi.fn((_key, value) => new Promise<void>(resolve => {
        finishWrite = () => {
          entry = value
          resolve()
        }
      })),
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({ store })
    const request = createClient().use(cache)
    const config = {
      url: '/pending-seed',
      extensions: {
        cache: { enabled: true, ttl: Infinity }
      }
    }
    const write = cache.set(config, { ready: true }, { ttl: Infinity })
    const read = request.get(config.url, config)

    await Promise.resolve()
    expect(store.get).not.toHaveBeenCalled()

    finishWrite()
    await write
    await expect(read).resolves.toEqual({ ready: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should order tag invalidation after a pending manual write', async () => {
    let finishWrite!: () => void
    let entry: CacheEntry | undefined
    const invalidateTags = vi.fn((tags: readonly string[]) => {
      if (entry?.tags?.some(tag => tags.includes(tag))) {
        entry = undefined
        return 1
      }

      return 0
    })
    const store: CacheStore = {
      get() {
        return entry
      },
      set(_key, value) {
        return new Promise<void>(resolve => {
          finishWrite = () => {
            entry = value
            resolve()
          }
        })
      },
      delete() {},
      invalidateTags,
      clear() {}
    }
    const cache = cachePlugin({ store })
    const config = { url: '/write-before-tag-invalidation' }
    const write = cache.set(config, { ready: true }, {
      ttl: Infinity,
      tags: ['pending-write']
    })
    const invalidation = cache.invalidateTags('pending-write')

    expect(invalidateTags).not.toHaveBeenCalled()
    finishWrite()

    await write
    await expect(invalidation).resolves.toBe(1)
    expect(entry).toBeUndefined()
  })

  it('should invalidate memory cache entries carrying any matching tag', async () => {
    const counts = new Map<string, number>()
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const key = String(url)
      const count = (counts.get(key) ?? 0) + 1

      counts.set(key, count)
      return Promise.resolve(createJsonResponse({ count }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = (tags: readonly string[]) => ({
      extensions: {
        cache: {
          enabled: true,
          tags,
          ttl: Infinity
        }
      }
    })

    await request.get('/tagged-user', config(['user:1']))
    await request.get('/tagged-list', config(['users', 'user:1']))
    await request.get('/tagged-other', config(['user:2']))

    expect(cache.invalidateTags('user:1')).toBe(2)

    await expect(
      request.get('/tagged-user', config(['user:1']))
    ).resolves.toEqual({ count: 2 })
    await expect(
      request.get('/tagged-list', config(['users', 'user:1']))
    ).resolves.toEqual({ count: 2 })
    await expect(
      request.get('/tagged-other', config(['user:2']))
    ).resolves.toEqual({ count: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(cache.getStats().invalidations).toBe(1)
  })

  it('should isolate tagged in-flight work from invalidation', async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => {
      resolvers.push(resolve)
    }))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          tags: ['account:1'],
          ttl: Infinity
        }
      }
    }
    const oldRequest = request.get('/tag-flight', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(cache.invalidateTags('account:1')).toBe(0)
    const currentRequest = request.get('/tag-flight', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    resolvers[1]?.(createJsonResponse({ generation: 'current' }))
    await expect(currentRequest).resolves.toEqual({ generation: 'current' })

    resolvers[0]?.(createJsonResponse({ generation: 'old' }))
    await expect(oldRequest).resolves.toEqual({ generation: 'old' })
    await expect(request.get('/tag-flight', config)).resolves.toEqual({
      generation: 'current'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should coordinate asynchronous tag invalidation by matching tag', async () => {
    let finishInvalidation!: (count: number) => void
    const store: CacheStore = {
      get: vi.fn(() => undefined),
      set() {},
      delete() {},
      invalidateTags: vi.fn(() => new Promise<number>(resolve => {
        finishInvalidation = resolve
      })),
      clear() {}
    }
    const fetchMock = vi.fn(() => Promise.resolve(
      createJsonResponse({ source: 'network' })
    ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({ store })
    const request = createClient().use(cache)
    const invalidation = cache.invalidateTags('group:pending')
    const matching = request.get('/matching-tag', {
      extensions: {
        cache: {
          enabled: true,
          tags: ['group:pending']
        }
      }
    })
    const unrelated = request.get('/unrelated-tag', {
      extensions: {
        cache: {
          enabled: true,
          tags: ['group:other']
        }
      }
    })

    await expect(unrelated).resolves.toEqual({ source: 'network' })
    expect(store.get).toHaveBeenCalledTimes(1)

    finishInvalidation(3)
    await expect(invalidation).resolves.toBe(3)
    await expect(matching).resolves.toEqual({ source: 'network' })
    expect(store.get).toHaveBeenCalledTimes(2)
  })

  it('should require safe tags and custom-store invalidation support', async () => {
    const store: CacheStore = {
      get: vi.fn(() => undefined),
      set() {},
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({ store })
    const request = createClient().use(cache)

    expect(() => cache.invalidateTags([])).toThrow(/at least one tag/)
    expect(() => cache.invalidateTags('unsupported')).toThrow(
      /does not support tag invalidation/
    )
    await expect(request.get('/invalid-tags', {
      extensions: {
        cache: {
          enabled: true,
          tags: ['x'.repeat(129)]
        }
      }
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(store.get).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should invalidate tags after a successful mutation', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ version: 1 })
      ))
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ updated: true })
      ))
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ version: 2 })
      ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const readConfig = {
      extensions: {
        cache: {
          enabled: true,
          tags: ['users'],
          ttl: Infinity
        }
      }
    }

    await request.get('/automatic-tags', readConfig)
    await expect(request.post('/automatic-tags', {
      json: { name: 'updated' },
      extensions: {
        cache: {
          invalidateTags: ['users']
        }
      }
    })).resolves.toEqual({ updated: true })
    await expect(
      request.get('/automatic-tags', readConfig)
    ).resolves.toEqual({ version: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(cache.getStats().invalidations).toBe(1)
  })

  it('should retain tagged entries after a failed mutation', async () => {
    const store = new MemoryCacheStore()
    const invalidate = vi.spyOn(store, 'invalidateTags')
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ version: 1 })
      ))
      .mockResolvedValueOnce(new Response('{"error":true}', {
        status: 503,
        headers: {
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))
    const readConfig = {
      extensions: {
        cache: {
          enabled: true,
          tags: ['stable-entry'],
          ttl: Infinity
        }
      }
    }

    await request.get('/failed-auto-tags', readConfig)
    await expect(request.patch('/failed-auto-tags', {
      json: { value: 2 },
      extensions: {
        cache: {
          invalidateTags: ['stable-entry']
        }
      }
    })).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 })
    await expect(
      request.get('/failed-auto-tags', readConfig)
    ).resolves.toEqual({ version: 1 })
    expect(invalidate).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not auto-invalidate after a response interceptor fails', async () => {
    const store = new MemoryCacheStore()
    const invalidate = vi.spyOn(store, 'invalidateTags')
    const fetchMock = vi.fn(() => Promise.resolve(
      createJsonResponse({ updated: true })
    ))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))

    request.interceptors.response.use(() => {
      throw new Error('application response failure')
    })

    await expect(request.post('/interceptor-auto-tags', {
      extensions: {
        cache: {
          invalidateTags: ['preserved-entry']
        }
      }
    })).rejects.toThrow('application response failure')
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('should invalidate once after a mutation eventually retries successfully', async () => {
    const store = new MemoryCacheStore()
    const invalidate = vi.spyOn(store, 'invalidateTags')
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => Promise.resolve(
        createJsonResponse({ updated: true })
      ))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(retryPlugin({
        retries: 1,
        delay: 0,
        methods: ['POST']
      }))
      .use(cachePlugin({ store }))

    await expect(request.post('/retry-auto-tags', {
      json: { value: 2 },
      extensions: {
        cache: {
          invalidateTags: ['retried-entry']
        }
      }
    })).resolves.toEqual({ updated: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('should await automatic asynchronous invalidation and preflight support', async () => {
    let finishInvalidation!: (count: number) => void
    const invalidateTags = vi.fn(() => new Promise<number>(resolve => {
      finishInvalidation = resolve
    }))
    const store: CacheStore = {
      get() {
        return undefined
      },
      set() {},
      delete() {},
      invalidateTags,
      clear() {}
    }
    const fetchMock = vi.fn(() => Promise.resolve(
      createJsonResponse({ updated: true })
    ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({ store })
    const request = createClient().use(cache)
    let settled = false
    const pending = request.delete('/async-auto-tags', {
      extensions: {
        cache: {
          invalidateTags: ['async-entry']
        }
      }
    }).then(value => {
      settled = true
      return value
    })

    await vi.waitFor(() => {
      expect(invalidateTags).toHaveBeenCalledTimes(1)
    })
    expect(settled).toBe(false)

    finishInvalidation(1)
    await expect(pending).resolves.toEqual({ updated: true })

    invalidateTags.mockRejectedValueOnce(new Error('invalidation failed'))
    await expect(request.post('/failed-async-auto-tags', {
      extensions: {
        cache: {
          invalidateTags: ['failed-async-entry']
        }
      }
    })).resolves.toEqual({ updated: true })
    expect(cache.getStats().invalidationErrors).toBe(1)

    const unsupported: CacheStore = {
      get() {},
      set() {},
      delete() {},
      clear() {}
    }
    const unsupportedRequest = createClient().use(cachePlugin({
      store: unsupported
    }))

    await expect(unsupportedRequest.post('/unsupported-auto-tags', {
      extensions: {
        cache: {
          invalidateTags: ['missing-capability']
        }
      }
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
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

  it('should not cache custom-parsed responses without an explicit key', async () => {
    let version = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      version += 1
      return Promise.resolve(createJsonResponse({ version }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      parseJson: (text: string) => JSON.parse(text),
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await expect(request.get('/custom-parser', config)).resolves.toEqual({
      version: 1
    })
    await expect(request.get('/custom-parser', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should cache custom-parsed responses under an explicit key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ value: 'network' })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      parseJson: (text: string) => JSON.parse(text),
      extensions: {
        cache: {
          enabled: true,
          key: 'custom-parser-v1',
          ttl: Infinity
        }
      }
    }

    await expect(request.get('/custom-parser', config)).resolves.toEqual({
      value: 'network'
    })
    await expect(request.get('/custom-parser', config)).resolves.toEqual({
      value: 'network'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not cache custom-serialized queries without an explicit key', async () => {
    let version = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      version += 1
      return Promise.resolve(createJsonResponse({ version }))
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      query: { tags: ['first', 'second'] },
      querySerializer: () => 'tags[]=first&tags[]=second',
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await expect(request.get('/custom-query', config)).resolves.toEqual({
      version: 1
    })
    await expect(request.get('/custom-query', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should cache custom-serialized queries under an explicit key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ value: 'network' })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      query: { tags: ['first', 'second'] },
      querySerializer: () => 'tags[]=first&tags[]=second',
      extensions: {
        cache: {
          enabled: true,
          key: 'custom-query-v1',
          ttl: Infinity
        }
      }
    }

    await expect(request.get('/custom-query', config)).resolves.toEqual({
      value: 'network'
    })
    await expect(request.get('/custom-query', config)).resolves.toEqual({
      value: 'network'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should coalesce equivalent requests through a cache-store lease', async () => {
    const entries = new Map<string, CacheEntry>()
    const waiters: Array<() => void> = []
    let held = false
    const acquire = (contended: boolean) => new Promise<{
      contended: boolean
      release(): void
    }>(resolve => {
      const grant = () => {
        held = true
        let active = true

        resolve({
          contended,
          release() {
            if (!active) {
              return
            }

            active = false
            held = false
            waiters.shift()?.()
          }
        })
      }

      if (held) {
        waiters.push(grant)
      } else {
        grant()
      }
    })
    const store: CacheStore = {
      get(key) {
        return entries.get(key)
      },
      set(key, entry) {
        entries.set(key, entry)
      },
      delete(key) {
        entries.delete(key)
      },
      clear() {
        entries.clear()
      },
      acquireRefreshLease() {
        return acquire(held)
      }
    }
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const firstClient = createClient().use(cachePlugin({ store }))
    const secondClient = createClient().use(cachePlugin({ store }))
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }
    const first = firstClient.get('/cross-context', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const second = secondClient.get('/cross-context', config)

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(createJsonResponse({ shared: true }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { shared: true },
      { shared: true }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should fall back to the network when lease coordination fails', async () => {
    const store: CacheStore = {
      get() {
        return undefined
      },
      set() {},
      delete() {},
      clear() {},
      acquireRefreshLease() {
        return Promise.reject(new Error('Lock manager unavailable'))
      }
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ fallback: true })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin({ store }))

    await expect(request.get('/lease-fallback', {
      extensions: {
        cache: { enabled: true }
      }
    })).resolves.toEqual({ fallback: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should abort while waiting for a cache-store lease', async () => {
    const acquireRefreshLease = vi.fn(() => new Promise<never>(() => {}))
    const store: CacheStore = {
      get() {
        return undefined
      },
      set() {},
      delete() {},
      clear() {},
      acquireRefreshLease
    }
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const request = createClient().use(cachePlugin({ store }))
    const pending = request.get('/lease-abort', {
      signal: controller.signal,
      extensions: {
        cache: { enabled: true }
      }
    })

    await vi.waitFor(() => {
      expect(acquireRefreshLease).toHaveBeenCalledTimes(1)
    })
    controller.abort('Stop waiting for cache refresh')

    await expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('should expose isolated cache statistics and reset them', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(
      createJsonResponse({ ok: true })
    ))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const extensions = {
      cache: {
        enabled: true,
        ttl: 1000
      }
    }

    await request.get('/observed-cache', { extensions })
    await request.get('/observed-cache', { extensions })
    await request.get('/observed-cache', {
      extensions,
      headers: {
        'cache-control': 'no-store'
      }
    })

    const snapshot = cache.getStats()

    expect(snapshot).toEqual({
      hits: 1,
      misses: 1,
      bypasses: 1,
      invalidations: 0,
      invalidationErrors: 0,
      deduplicated: 0,
      revalidations: 0,
      staleIfError: 0,
      staleWhileRevalidate: 0,
      backgroundRefreshes: 0,
      backgroundRefreshSuccesses: 0,
      backgroundRefreshErrors: 0
    })

    ;(snapshot as { hits: number }).hits = 99
    expect(cache.getStats().hits).toBe(1)

    cache.resetStats()
    expect(Object.values(cache.getStats()).every(value => value === 0)).toBe(true)
  })

  it('should observe deduplication without exposing request details', async () => {
    let resolveFetch!: (response: Response) => void
    const events: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => {
      resolveFetch = resolve
    }))
    const onEvent = vi
      .fn((event: CacheEvent) => {
        events.push({ ...event })

        if (events.length === 1) {
          throw new Error('observer failed')
        }

        return Promise.reject(new Error('async observer failed'))
      })

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({ onEvent })
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 1000
        }
      }
    }
    const leader = request.get('/private-path?token=secret', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const follower = request.get('/private-path?token=secret', config)

    await vi.waitFor(() => {
      expect(cache.getStats().deduplicated).toBe(1)
    })

    resolveFetch(createJsonResponse({ ok: true }))
    await expect(Promise.all([leader, follower])).resolves.toEqual([
      { ok: true },
      { ok: true }
    ])
    expect(cache.getStats()).toMatchObject({
      misses: 1,
      deduplicated: 1
    })
    expect(events.map(event => event.type)).toEqual([
      'miss',
      'deduplicated'
    ])
    expect(events.every(event => {
      return Object.keys(event).sort().join(',') === 'timestamp,type'
    })).toBe(true)
  })

  it('should report stale recovery and conditional revalidation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=0, stale-if-error=5',
          'content-type': 'application/json'
        }
      }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=0',
          'content-type': 'application/json',
          etag: '"v2"'
        }
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: {
          'cache-control': 'max-age=60'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin()
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/stale-observed', config)
    await expect(request.get('/stale-observed', config)).resolves.toEqual({
      version: 1
    })
    await request.get('/etag-observed', config)
    await expect(request.get('/etag-observed', config)).resolves.toEqual({
      version: 2
    })
    expect(cache.getStats()).toMatchObject({
      misses: 4,
      staleIfError: 1,
      revalidations: 1
    })
  })

  it('should report background refresh outcomes without using stale fallback', async () => {
    const events: string[] = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': [
            'max-age=0',
            'stale-if-error=5',
            'stale-while-revalidate=5'
          ].join(', '),
          'content-type': 'application/json'
        }
      }))
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({
      onEvent(event) {
        events.push(event.type)
      }
    })
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 10000
        }
      }
    }

    await request.get('/failed-background-refresh', config)
    await expect(
      request.get('/failed-background-refresh', config)
    ).resolves.toEqual({ version: 1 })

    await vi.waitFor(() => {
      expect(cache.getStats().backgroundRefreshErrors).toBe(1)
    })

    expect(cache.getStats()).toMatchObject({
      misses: 1,
      staleIfError: 0,
      staleWhileRevalidate: 1,
      backgroundRefreshes: 1,
      backgroundRefreshSuccesses: 0,
      backgroundRefreshErrors: 1
    })
    expect(events).toContain('background-refresh-error')
  })
})
