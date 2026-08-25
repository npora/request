import {
  expect,
  test
} from '@playwright/test'

interface User {
  id: number
  name: string
}

interface BrowserRequestClient {
  extend(options?: BrowserClientOptions): BrowserRequestClient

  get<T>(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<T>

  post<T>(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<T>

  headResponse(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<{
    data: undefined
    status: number
  }>

  options<T>(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<T>
}

interface BrowserClientOptions {
  baseURL?: string
  headers?: Record<string, string>
  query?: Record<string, string | number>
}

interface BrowserRequestConfig {
  headers?: Record<string, string>
  json?: Record<string, unknown>
  query?: Record<string, string | number>
  timeout?: number
  maxResponseSize?: number
  schema?: BrowserStandardSchema
  responseType?:
    | 'json'
    | 'text'
    | 'blob'
    | 'arrayBuffer'
    | 'stream'
    | 'sse'
    | 'ndjson'
}

interface BrowserStandardSchema {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) =>
      | { value: unknown }
      | { issues: ReadonlyArray<{ message: string }> }
  }
}

interface BrowserWindow extends Window {
  nporaRequest?: BrowserRequestClient
  nporaReady?: boolean
  nporaError?: string
}

test(
  'should send a GET request in the browser',
  async ({ page }) => {
    await page.goto('/')

    await page.waitForFunction(() => {
      const browserWindow =
        window as BrowserWindow

      return (
        browserWindow.nporaReady === true ||
        typeof browserWindow.nporaError ===
        'string'
      )
    })

    const initializationError =
      await page.evaluate(() => {
        const browserWindow =
          window as BrowserWindow

        return browserWindow.nporaError
      })

    expect(
      initializationError
    ).toBeUndefined()

    const user =
      await page.evaluate(async () => {
        const browserWindow =
          window as BrowserWindow

        if (!browserWindow.nporaRequest) {
          throw new Error(
            'Npora request client is unavailable'
          )
        }

        return browserWindow.nporaRequest.get<User>(
          '/user'
        )
      })

    expect(user).toEqual({
      id: 1,
      name: 'Npora'
    })
  }
)

test(
  'should validate and transform a response in the browser',
  async ({ page }) => {
    await openFixture(page)

    const user = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      return request.get<User>('/user', {
        schema: {
          '~standard': {
            version: 1,
            vendor: 'browser-test',
            validate(value) {
              const record = value as User

              return {
                value: {
                  id: record.id,
                  name: record.name.toUpperCase()
                }
              }
            }
          }
        }
      })
    })

    expect(user).toEqual({
      id: 1,
      name: 'NPORA'
    })
  }
)

test(
  'should merge extended defaults and send JSON in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const browserWindow = window as BrowserWindow
      const request = browserWindow.nporaRequest

      if (!request) {
        throw new Error(
          'Npora request client is unavailable'
        )
      }

      const child = request.extend({
        headers: {
          'x-client': 'browser'
        },
        query: {
          source: 'extended'
        }
      })

      return child.post<{
        method: string
        query: Record<string, string>
        headers: Record<string, string>
        body: Record<string, unknown>
      }>('/echo', {
        headers: {
          'x-request': 'child'
        },
        json: {
          name: 'Npora'
        }
      })
    })

    expect(result).toMatchObject({
      method: 'POST',
      query: {
        source: 'extended'
      },
      headers: {
        'x-client': 'browser',
        'x-request': 'child',
        'content-type': 'application/json'
      },
      body: {
        name: 'Npora'
      }
    })
  }
)

test(
  'should preserve native searchParams order in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      return request.get<{
        queryEntries: Array<[string, string]>
      }>('/echo', {
        searchParams: new URLSearchParams([
          ['tag', 'first'],
          ['search', 'hello world'],
          ['tag', 'second']
        ])
      })
    })

    expect(result.queryEntries).toEqual([
      ['tag', 'first'],
      ['search', 'hello world'],
      ['tag', 'second']
    ])
  }
)

test(
  'should accept native searchParams created by another realm',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest
      const frame = document.createElement('iframe')

      document.body.append(frame)

      try {
        if (!request || !frame.contentWindow) {
          throw new Error('Npora request client or iframe is unavailable')
        }

        const searchParams = new frame.contentWindow.URLSearchParams([
          ['tag', 'first'],
          ['tag', 'second']
        ])

        return request.get<{
          queryEntries: Array<[string, string]>
        }>('/echo', {
          searchParams
        })
      } finally {
        frame.remove()
      }
    })

    expect(result.queryEntries).toEqual([
      ['tag', 'first'],
      ['tag', 'second']
    ])
  }
)

test(
  'should expose unified HTTP and timeout errors in the browser',
  async ({ page }) => {
    await openFixture(page)

    const errors = await page.evaluate(async () => {
      const browserWindow = window as BrowserWindow
      const request = browserWindow.nporaRequest

      if (!request) {
        throw new Error(
          'Npora request client is unavailable'
        )
      }

      const capture = async (
        operation: () => Promise<unknown>
      ) => {
        try {
          await operation()

          return {
            code: 'NO_ERROR'
          }
        } catch (error) {
          const requestError = error as {
            code?: string
            status?: number
            data?: unknown
          }

          return {
            code: requestError.code,
            status: requestError.status,
            data: requestError.data
          }
        }
      }

      return {
        http: await capture(() => {
          return request.get('/error')
        }),
        timeout: await capture(() => {
          return request.get('/slow', {
            timeout: 10
          })
        })
      }
    })

    expect(errors.http).toEqual({
      code: 'HTTP_ERROR',
      status: 422,
      data: {
        message: 'Invalid browser request'
      }
    })
    expect(errors.timeout).toEqual({
      code: 'TIMEOUT_ERROR',
      status: undefined,
      data: undefined
    })
  }
)

test(
  'should send a request from a Web Worker',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const workerSource = `
        self.onmessage = async event => {
          try {
            const { createClient } = await import(
              event.data.moduleURL
            )
            const request = createClient({
              baseURL: event.data.baseURL
            })
            const data = await request.get('/user')

            self.postMessage({ data })
          } catch (error) {
            self.postMessage({
              error:
                error instanceof Error
                  ? error.message
                  : String(error)
            })
          }
        }
      `
      const workerURL = URL.createObjectURL(
        new Blob([workerSource], {
          type: 'text/javascript'
        })
      )

      try {
        return await new Promise<{
          data?: User
          error?: string
        }>((resolve, reject) => {
          const worker = new Worker(workerURL, {
            type: 'module'
          })

          worker.onmessage = event => {
            worker.terminate()
            resolve(event.data)
          }
          worker.onerror = event => {
            worker.terminate()
            reject(new Error(event.message))
          }
          worker.postMessage({
            moduleURL: `${location.origin}/dist/index.js`,
            baseURL: `${location.origin}/api`
          })
        })
      } finally {
        URL.revokeObjectURL(workerURL)
      }
    })

    expect(result).toEqual({
      data: {
        id: 1,
        name: 'Npora'
      }
    })
  }
)

test(
  'should execute the plugin pipeline in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const key = crypto.randomUUID()
      const firstConfig = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 1000
          }
        },
        query: {
          key,
          page: 1,
          cache: 'enabled'
        }
      }
      const secondConfig = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 1000
          }
        },
        query: {
          page: 1,
          key,
          cache: 'enabled'
        }
      }

      return {
        first: await request.get('/count', firstConfig),
        second: await request.get('/count', secondConfig)
      }
    })

    expect(result).toEqual({
      first: {
        count: 1
      },
      second: {
        count: 1
      }
    })
  }
)

test(
  'should not persist no-store responses in the browser cache plugin',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const key = crypto.randomUUID()
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 1000
          }
        },
        query: {
          key
        }
      }

      return {
        first: await request.get('/count', config),
        second: await request.get('/count', config)
      }
    })

    expect(result).toEqual({
      first: {
        count: 1
      },
      second: {
        count: 2
      }
    })
  }
)

test(
  'should revalidate stale browser cache entries with ETag',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const key = crypto.randomUUID()
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 30000
          }
        },
        query: { key }
      }

      return {
        first: await request.get('/revalidate', config),
        second: await request.get('/revalidate', config),
        third: await request.get('/revalidate', config)
      }
    })

    expect(result).toEqual({
      first: { count: 1 },
      second: { count: 1 },
      third: { count: 1 }
    })
  }
)

test(
  'should force browser revalidation with request no-cache',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const key = crypto.randomUUID()
      const extensions = {
        cache: {
          enabled: true,
          ttl: 30000
        }
      }
      const query = {
        fresh: 'true',
        key
      }

      return {
        first: await request.get('/revalidate', {
          extensions,
          query
        }),
        forced: await request.get('/revalidate', {
          extensions,
          headers: {
            'cache-control': 'no-cache'
          },
          query
        }),
        cached: await request.get('/revalidate', {
          extensions,
          query
        })
      }
    })

    expect(result).toEqual({
      first: { count: 1 },
      forced: { count: 1 },
      cached: { count: 1 }
    })
  }
)

test(
  'should serve stale browser data after a 503 response',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 30000
          }
        },
        fetchOptions: {
          cache: 'no-store' as const
        },
        query: {
          key: crypto.randomUUID()
        }
      }

      return {
        first: await request.get('/stale-if-error', config),
        fallback: await request.get('/stale-if-error', config)
      }
    })

    expect(result).toEqual({
      first: { count: 1 },
      fallback: { count: 1 }
    })
  }
)

test(
  'should refresh stale browser data in the background',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 30000
          }
        },
        fetchOptions: {
          cache: 'no-store' as const
        },
        query: {
          key: crypto.randomUUID()
        }
      }
      const first = await request.get('/stale-while-revalidate', config)
      const stale = await request.get('/stale-while-revalidate', config)

      await new Promise(resolve => setTimeout(resolve, 100))

      return {
        first,
        stale,
        refreshed: await request.get('/stale-while-revalidate', config)
      }
    })

    expect(result).toEqual({
      first: { count: 1 },
      stale: { count: 1 },
      refreshed: { count: 2 }
    })
  }
)

test(
  'should expose privacy-safe browser cache metrics',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const events: Array<Record<string, unknown>> = []
      const cache = cachePlugin({
        onEvent(event) {
          events.push(event)
        }
      })
      const request = createClient({
        baseURL: '/api'
      }).use(cache)
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 30000
          }
        },
        fetchOptions: {
          cache: 'no-store' as const
        },
        query: {
          key: crypto.randomUUID()
        }
      }

      await request.get('/stale-while-revalidate', config)
      await request.get('/stale-while-revalidate', config)
      await new Promise(resolve => setTimeout(resolve, 100))
      await request.get('/stale-while-revalidate', config)
      await cache.delete({
        ...config,
        url: '/stale-while-revalidate',
        baseURL: '/api'
      })
      const afterInvalidation = await request.get(
        '/stale-while-revalidate',
        config
      )

      return {
        afterInvalidation,
        stats: cache.getStats(),
        types: events.map(event => event.type),
        fields: [...new Set(events.flatMap(Object.keys))].sort()
      }
    })

    expect(result.stats).toMatchObject({
      hits: 1,
      misses: 2,
      invalidations: 1,
      staleWhileRevalidate: 1,
      backgroundRefreshes: 1,
      backgroundRefreshSuccesses: 1,
      backgroundRefreshErrors: 0
    })
    expect(result.types).toContain('background-refresh-success')
    expect(result.afterInvalidation).toEqual({ count: 3 })
    expect(result.fields).toEqual(['timestamp', 'type'])
  }
)

test(
  'should invalidate tagged browser cache entries',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const cache = cachePlugin()
      const request = createClient({ baseURL: '/api' }).use(cache)
      const firstKey = crypto.randomUUID()
      const secondKey = crypto.randomUUID()
      const automaticKey = crypto.randomUUID()
      const config = (key: string, tags: string[]) => ({
        extensions: {
          cache: {
            enabled: true,
            tags
          }
        },
        fetchOptions: {
          cache: 'no-store' as const
        },
        query: {
          cache: 'enabled',
          key
        }
      })
      const firstConfig = config(firstKey, ['account:1', 'accounts'])
      const secondConfig = config(secondKey, ['account:2', 'accounts'])
      const automaticConfig = config(automaticKey, ['accounts:auto'])

      await request.get('/count', firstConfig)
      await request.get('/count', secondConfig)
      await request.get('/count', automaticConfig)
      const invalidated = cache.invalidateTags('account:1')
      await request.post('/echo', {
        json: { updated: true },
        extensions: {
          cache: {
            invalidateTags: ['accounts:auto']
          }
        }
      })

      return {
        invalidated,
        first: await request.get('/count', firstConfig),
        second: await request.get('/count', secondConfig),
        automatic: await request.get('/count', automaticConfig)
      }
    })

    expect(result).toEqual({
      invalidated: 1,
      first: { count: 2 },
      second: { count: 1 },
      automatic: { count: 2 }
    })
  }
)

test(
  'should seed and update browser cache entries',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const cache = cachePlugin()
      const request = createClient({ baseURL: '/api' }).use(cache)
      const config = {
        url: '/count',
        extensions: {
          cache: {
            enabled: true,
            key: crypto.randomUUID(),
            ttl: Infinity
          }
        }
      }

      await cache.set(config, { count: 40 }, {
        ttl: Infinity,
        tags: ['programmatic']
      })
      const seeded = await request.get(config.url, config)
      const updated = await cache.update<{ count: number }>(
        config,
        value => ({ count: value.count + 2 })
      )

      return {
        seeded,
        updated,
        value: await request.get(config.url, config),
        invalidated: await cache.invalidateTags('programmatic')
      }
    })

    expect(result).toEqual({
      seeded: { count: 40 },
      updated: true,
      value: { count: 42 },
      invalidated: 1
    })
  }
)

test(
  'should persist namespaced browser cache entries',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient,
        WebStorageCacheStore
      } = await import(moduleURL)
      const namespace = crypto.randomUUID()
      const config = {
        url: '/count',
        extensions: {
          cache: {
            enabled: true,
            key: crypto.randomUUID(),
            ttl: Infinity
          }
        }
      }
      const firstStore = new WebStorageCacheStore(sessionStorage, {
        namespace
      })
      const firstCache = cachePlugin({ store: firstStore })

      await firstCache.set(config, { persisted: true }, {
        ttl: Infinity,
        tags: ['persisted']
      })

      const secondStore = new WebStorageCacheStore(sessionStorage, {
        namespace
      })
      const request = createClient({ baseURL: '/api' }).use(
        cachePlugin({ store: secondStore })
      )
      const value = await request.get(config.url, config)
      const removed = secondStore.invalidateTags(['persisted'])

      secondStore.clear()
      return { value, removed }
    })

    expect(result).toEqual({
      value: { persisted: true },
      removed: 1
    })
  }
)

test(
  'should persist structured cache data in IndexedDB',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient,
        IndexedDBCacheStore
      } = await import(moduleURL)
      const databaseName = `npora-cache-${crypto.randomUUID()}`
      const namespace = 'account:1'
      const config = {
        url: '/count',
        extensions: {
          cache: {
            enabled: true,
            key: 'indexed-profile',
            ttl: Infinity
          }
        }
      }
      const firstStore = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace
      })
      const firstCache = cachePlugin({ store: firstStore })
      const createdAt = new Date('2026-08-25T00:00:00.000Z')

      await firstCache.set(config, {
        createdAt,
        bytes: new Uint8Array([1, 2, 3])
      }, {
        ttl: Infinity,
        tags: ['indexed-profile']
      })

      const secondStore = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace
      })
      const request = createClient({ baseURL: '/api' }).use(
        cachePlugin({ store: secondStore })
      )
      const restored = await request.get<{
        createdAt: Date
        bytes: Uint8Array
      }>(config.url, config)
      const isolatedStore = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'account:2'
      })
      const isolated = await isolatedStore.get('indexed-profile')
      const removed = await secondStore.invalidateTags(['indexed-profile'])
      const lruStore = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'lru',
        maxEntries: 2
      })
      const entry = (data: string) => ({
        data,
        expiresAt: Infinity,
        status: 200,
        statusText: 'OK',
        headers: []
      })

      await lruStore.set('first', entry('first'))
      await new Promise(resolve => setTimeout(resolve, 2))
      await lruStore.set('second', entry('second'))
      await new Promise(resolve => setTimeout(resolve, 2))
      await lruStore.get('first')
      await new Promise(resolve => setTimeout(resolve, 2))
      await lruStore.set('third', entry('third'))
      const lru = {
        first: (await lruStore.get('first'))?.data,
        second: await lruStore.get('second'),
        third: (await lruStore.get('third'))?.data
      }
      const tiedLruStore = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'lru-tie',
        maxEntries: 2
      })

      await tiedLruStore.set('zeta', entry('zeta'))
      await tiedLruStore.set('alpha', entry('alpha'))
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1)

        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('entries', 'readwrite')
          const store = transaction.objectStore('entries')

          for (const key of ['alpha', 'zeta']) {
            const request = store.get(`lru-tie\0${key}`)

            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              request.result.accessedAt = 1
              store.put(request.result)
            }
          }
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
        }
      })
      await tiedLruStore.set('newest', entry('newest'))
      const tiedLru = {
        alpha: await tiedLruStore.get('alpha'),
        zeta: (await tiedLruStore.get('zeta'))?.data,
        newest: (await tiedLruStore.get('newest'))?.data
      }
      const corruptStore = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'corrupt'
      })

      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1)

        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('entries', 'readwrite')

          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.objectStore('entries').put({
            key: 'corrupt\0entry',
            namespace: 'corrupt',
            status: 'invalid'
          })
        }
      })
      const corrupt = await corruptStore.get('entry')

      await Promise.all([
        firstStore.close(),
        secondStore.close(),
        isolatedStore.close(),
        lruStore.close(),
        tiedLruStore.close(),
        corruptStore.close()
      ])
      indexedDB.deleteDatabase(databaseName)

      return {
        date: restored.createdAt instanceof Date
          ? restored.createdAt.toISOString()
          : 'not-a-date',
        bytes: [...restored.bytes],
        isolated,
        removed,
        lru,
        tiedLru,
        corrupt
      }
    })

    expect(result).toEqual({
      date: '2026-08-25T00:00:00.000Z',
      bytes: [1, 2, 3],
      isolated: undefined,
      removed: 1,
      lru: {
        first: 'first',
        second: undefined,
        third: 'third'
      },
      tiedLru: {
        alpha: undefined,
        zeta: 'zeta',
        newest: 'newest'
      },
      corrupt: undefined
    })
  }
)

test(
  'should isolate and prune IndexedDB cache schema versions',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const { IndexedDBCacheStore } = await import(moduleURL)
      const databaseName = `npora-schema-${crypto.randomUUID()}`
      const namespace = 'account:1'
      const entry = (version: number) => ({
        data: { version },
        expiresAt: Infinity,
        status: 200,
        statusText: 'OK',
        headers: []
      })
      const version1 = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace
      })

      await version1.set('profile', entry(1))
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1)

        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('entries', 'readwrite')
          const store = transaction.objectStore('entries')
          const request = store.get(`${namespace}\0profile`)

          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const legacy = request.result as { schemaVersion?: number }

            delete legacy.schemaVersion
            store.put(legacy)
          }
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
        }
      })
      const legacyRead = await version1.get('profile')
      const cleanupReasons: string[] = []

      const version2 = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace,
        schemaVersion: 2,
        onEvent: event => cleanupReasons.push(event.reason)
      })
      const upgradedRead = await version2.get('profile')

      await version2.set('profile', entry(2))

      const oldRead = await version1.get('profile')

      await version1.clear()

      const survivedOldClear = await version2.get('profile')
      const version3 = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace,
        schemaVersion: 3,
        onEvent: event => cleanupReasons.push(event.reason)
      })
      const nextUpgradeRead = await version3.get('profile')

      await version3.set('profile', entry(3))
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1)

        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('entries', 'readwrite')

          transaction.objectStore('entries').put({
            key: `${namespace}\0@npora-schema:4\0future-envelope`,
            namespace,
            schemaVersion: 4,
            futurePayload: { incompatible: true }
          })
          transaction.objectStore('entries').put({
            key: `${namespace}\0future-collision`,
            namespace,
            schemaVersion: 4,
            futurePayload: { collision: true }
          })
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
        }
      })

      await version1.get('future-collision')
      await version1.delete('future-collision')
      await version1.set('future-collision', entry(1))
      await version1.set('old-write', entry(1))
      await version1.clear()
      await version1.compact({ expiredBefore: Date.now() })

      const records = await new Promise<Array<{
        key: string
        schemaVersion?: number
        futurePayload?: { collision?: boolean }
      }>>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1)

        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('entries', 'readonly')
          const request = transaction
            .objectStore('entries')
            .index('namespace')
            .getAll(namespace)

          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result)
          transaction.oncomplete = () => database.close()
        }
      })
      let invalidVersion: string | undefined

      try {
        new IndexedDBCacheStore(indexedDB, {
          databaseName,
          namespace,
          schemaVersion: 0
        })
      } catch (error) {
        invalidVersion = (error as { code?: string }).code
      }

      await Promise.all([
        version1.close(),
        version2.close(),
        version3.close()
      ])
      indexedDB.deleteDatabase(databaseName)

      return {
        legacyRead: legacyRead?.data,
        upgradedRead,
        oldRead,
        survivedOldClear: survivedOldClear?.data,
        nextUpgradeRead,
        storedVersions: records
          .map(record => record.schemaVersion)
          .sort((first, second) => (first ?? 0) - (second ?? 0)),
        collisionPreserved: records.some(record => (
          record.key === `${namespace}\0future-collision` &&
          record.futurePayload?.collision === true
        )),
        cleanupReasons,
        invalidVersion
      }
    })

    expect(result).toEqual({
      legacyRead: { version: 1 },
      upgradedRead: undefined,
      oldRead: undefined,
      survivedOldClear: { version: 2 },
      nextUpgradeRead: undefined,
      storedVersions: [3, 4, 4],
      collisionPreserved: true,
      cleanupReasons: ['schema-version', 'schema-version'],
      invalidVersion: 'CONFIG_ERROR'
    })
  }
)

test(
  'should enforce an approximate IndexedDB cache byte budget',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const { IndexedDBCacheStore } = await import(moduleURL)
      const databaseName = `npora-bytes-${crypto.randomUUID()}`
      const namespace = 'bounded'
      const maxBytes = 1500
      const events: Array<{
        type: string
        reason: string
        entries: number
        estimatedBytes: number
        timestamp: number
      }> = []
      const store = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace,
        maxEntries: Infinity,
        maxBytes,
        onEvent: event => {
          events.push(event)
          return Promise.reject(new Error('observer failure'))
        }
      })
      const entry = (index: number, length = 200) => ({
        data: {
          index,
          value: 'x'.repeat(length)
        },
        expiresAt: Infinity,
        status: 200,
        statusText: 'OK',
        headers: []
      })

      for (let index = 0; index < 10; index += 1) {
        await store.set(`entry:${index}`, entry(index))
      }

      await store.set('oversized', entry(99, 2000))

      const records = await new Promise<Array<{ size?: number }>>(
        (resolve, reject) => {
          const open = indexedDB.open(databaseName, 1)

          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const database = open.result
            const transaction = database.transaction('entries', 'readonly')
            const request = transaction
              .objectStore('entries')
              .index('namespace')
              .getAll(namespace)

            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result)
            transaction.oncomplete = () => database.close()
          }
        }
      )
      const newest = await store.get('entry:9')
      const oversized = await store.get('oversized')
      const usage = await store.getUsage()
      await Promise.resolve()

      await store.close()
      indexedDB.deleteDatabase(databaseName)

      return {
        count: records.length,
        totalBytes: records.reduce(
          (total, record) => total + (record.size ?? 0),
          0
        ),
        validSizes: records.every(record => (
          Number.isSafeInteger(record.size) && record.size! > 0
        )),
        usage,
        events,
        exposesPrivateData: JSON.stringify(events).includes(namespace) ||
          JSON.stringify(events).includes('entry:') ||
          JSON.stringify(events).includes('xxxx'),
        newest: newest?.data,
        oversized
      }
    })

    expect(result.count).toBeGreaterThan(0)
    expect(result.count).toBeLessThan(10)
    expect(result.totalBytes).toBeLessThanOrEqual(1500)
    expect(result.validSizes).toBe(true)
    expect(result.usage).toEqual({
      entries: result.count,
      estimatedBytes: result.totalBytes,
      maxEntries: Infinity,
      maxBytes: 1500,
      schemaVersion: 1
    })
    expect(result.events.some(event => (
      event.type === 'eviction' && event.reason === 'max-bytes'
    ))).toBe(true)
    expect(result.events.some(event => (
      event.type === 'rejection' && event.reason === 'oversized'
    ))).toBe(true)
    expect(result.events.every(event => (
      event.entries > 0 &&
      event.estimatedBytes > 0 &&
      Number.isFinite(event.timestamp)
    ))).toBe(true)
    expect(result.exposesPrivateData).toBe(false)
    expect(result.newest).toEqual({
      index: 9,
      value: 'x'.repeat(200)
    })
    expect(result.oversized).toBeUndefined()
  }
)

test(
  'should apply an IndexedDB cache admission policy',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const { IndexedDBCacheStore } = await import(moduleURL)
      const databaseName = `npora-admission-${crypto.randomUUID()}`
      const events: Array<{
        reason: string
        entries: number
        estimatedBytes: number
      }> = []
      const inspected: Array<{
        status: number
        estimatedBytes: number
      }> = []
      const store = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'private-namespace',
        async shouldPersist(entry, estimatedBytes) {
          inspected.push({ status: entry.status, estimatedBytes })
          const data = entry.data as {
            decision: 'accept' | 'reject' | 'error'
          }

          if (data.decision === 'error') {
            throw new Error('admission failed')
          }

          return data.decision === 'accept'
        },
        onEvent: event => events.push(event)
      })
      const entry = (
        value: string,
        decision: 'accept' | 'reject' | 'error'
      ) => ({
        data: { value, decision },
        expiresAt: Infinity,
        status: 200,
        statusText: 'OK',
        headers: []
      })

      await store.set('accepted-key', entry('accepted-secret', 'accept'))
      await store.set('rejected-key', entry('rejected-secret', 'reject'))
      await store.set('replace-key', entry('old-value', 'accept'))
      await store.set('replace-key', entry('new-secret', 'reject'))
      await store.set('error-key', entry('preserved-value', 'accept'))

      let policyError: string | undefined

      try {
        await store.set('error-key', entry('failed-secret', 'error'))
      } catch (error) {
        policyError = (error as Error).message
      }

      const accepted = await store.get('accepted-key')
      const rejected = await store.get('rejected-key')
      const replaced = await store.get('replace-key')
      const preserved = await store.get('error-key')
      const usage = await store.getUsage()

      await store.close()
      indexedDB.deleteDatabase(databaseName)

      return {
        accepted: accepted?.data,
        rejected,
        replaced,
        preserved: preserved?.data,
        policyError,
        usage,
        inspected,
        events,
        exposesPrivateData: JSON.stringify(events).includes('key') ||
          JSON.stringify(events).includes('secret') ||
          JSON.stringify(events).includes('private-namespace')
      }
    })

    expect(result.accepted).toEqual({
      value: 'accepted-secret',
      decision: 'accept'
    })
    expect(result.rejected).toBeUndefined()
    expect(result.replaced).toBeUndefined()
    expect(result.preserved).toEqual({
      value: 'preserved-value',
      decision: 'accept'
    })
    expect(result.policyError).toBe('admission failed')
    expect(result.usage.entries).toBe(2)
    expect(result.inspected).toHaveLength(6)
    expect(result.inspected.every(item => (
      item.status === 200 && item.estimatedBytes > 0
    ))).toBe(true)
    expect(result.events).toHaveLength(2)
    expect(result.events.every(event => (
      event.reason === 'admission-policy' &&
      event.entries === 1 &&
      event.estimatedBytes > 0
    ))).toBe(true)
    expect(result.exposesPrivateData).toBe(false)
  }
)

test(
  'should compact expired IndexedDB cache entries in bounded batches',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const { IndexedDBCacheStore } = await import(moduleURL)
      const databaseName = `npora-compact-${crypto.randomUUID()}`
      const events: Array<{
        reason: string
        entries: number
        estimatedBytes: number
      }> = []
      const store = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'private-compaction',
        onEvent: event => events.push(event)
      })
      const now = Date.now()
      const entry = (value: string, expiresAt: number) => ({
        data: { value },
        expiresAt,
        status: 200,
        statusText: 'OK',
        headers: []
      })

      await store.set('stale:1', entry('private-one', now - 2000))
      await store.set('stale:2', entry('private-two', now - 1000))
      await store.set('fresh', entry('public', now + 60_000))

      const retained = await store.compact({
        expiredBefore: now - 3000
      })
      const first = await store.compact({
        expiredBefore: now,
        maxRemovals: 1
      })
      const second = await store.compact({
        expiredBefore: now,
        maxRemovals: 1
      })
      const final = await store.compact({ expiredBefore: now })
      const stale1 = await store.get('stale:1')
      const stale2 = await store.get('stale:2')
      const fresh = await store.get('fresh')
      const usage = await store.getUsage()
      let invalidBoundary: string | undefined
      let invalidLimit: string | undefined

      try {
        await store.compact({ expiredBefore: Infinity })
      } catch (error) {
        invalidBoundary = (error as { code?: string }).code
      }

      try {
        await store.compact({ maxRemovals: 0 })
      } catch (error) {
        invalidLimit = (error as { code?: string }).code
      }

      await store.close()
      indexedDB.deleteDatabase(databaseName)

      return {
        retained,
        first,
        second,
        final,
        stale1,
        stale2,
        fresh: fresh?.data,
        usage,
        invalidBoundary,
        invalidLimit,
        events,
        exposesPrivateData: JSON.stringify(events).includes('stale:') ||
          JSON.stringify(events).includes('private')
      }
    })

    expect(result.retained.removedEntries).toBe(0)
    expect(result.first.removedEntries).toBe(1)
    expect(result.first.hasMore).toBe(true)
    expect(result.second.removedEntries).toBe(1)
    expect(result.second.hasMore).toBe(true)
    expect(result.final.removedEntries).toBe(0)
    expect(result.final.hasMore).toBe(false)
    expect(result.first.estimatedBytesFreed).toBeGreaterThan(0)
    expect(result.second.estimatedBytesFreed).toBeGreaterThan(0)
    expect(result.stale1).toBeUndefined()
    expect(result.stale2).toBeUndefined()
    expect(result.fresh).toEqual({ value: 'public' })
    expect(result.usage.entries).toBe(1)
    expect(result.invalidBoundary).toBe('CONFIG_ERROR')
    expect(result.invalidLimit).toBe('CONFIG_ERROR')
    expect(result.events).toHaveLength(2)
    expect(result.events.every(event => (
      event.reason === 'expired' &&
      event.entries === 1 &&
      event.estimatedBytes > 0
    ))).toBe(true)
    expect(result.exposesPrivateData).toBe(false)
  }
)

test(
  'should promote persistent entries through a tiered cache',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient,
        IndexedDBCacheStore,
        MemoryCacheStore,
        TieredCacheStore
      } = await import(moduleURL)
      const databaseName = `npora-tiered-${crypto.randomUUID()}`
      const config = {
        url: '/count',
        extensions: {
          cache: {
            enabled: true,
            key: 'tiered-entry',
            ttl: Infinity
          }
        }
      }
      const firstPersistent = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'tiered'
      })
      const firstCache = cachePlugin({
        store: new TieredCacheStore({
          primary: new MemoryCacheStore(),
          secondary: firstPersistent
        })
      })

      await firstCache.set(config, { source: 'persistent' }, {
        ttl: Infinity
      })
      await firstPersistent.close()

      const secondPersistent = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'tiered'
      })
      const request = createClient({ baseURL: '/api' }).use(
        cachePlugin({
          store: new TieredCacheStore({
            primary: new MemoryCacheStore(),
            secondary: secondPersistent
          })
        })
      )
      const restored = await request.get(config.url, config)

      await secondPersistent.close()
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(databaseName)

        deletion.onerror = () => reject(deletion.error)
        deletion.onsuccess = () => resolve()
      })

      return {
        restored,
        memoryHit: await request.get(config.url, config)
      }
    })

    expect(result).toEqual({
      restored: { source: 'persistent' },
      memoryHit: { source: 'persistent' }
    })
  }
)

test(
  'should synchronize tiered cache invalidation across contexts',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient,
        IndexedDBCacheStore,
        MemoryCacheStore,
        TieredCacheStore
      } = await import(moduleURL)
      const databaseName = `npora-sync-${crypto.randomUUID()}`
      const channelName = `npora-sync-${crypto.randomUUID()}`
      const firstChannel = new BroadcastChannel(channelName)
      const secondChannel = new BroadcastChannel(channelName)
      const firstPersistent = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'synchronized'
      })
      const secondPersistent = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'synchronized'
      })
      const firstStore = new TieredCacheStore({
        primary: new MemoryCacheStore(),
        secondary: firstPersistent,
        broadcast: { channel: firstChannel }
      })
      const secondStore = new TieredCacheStore({
        primary: new MemoryCacheStore(),
        secondary: secondPersistent,
        broadcast: { channel: secondChannel }
      })
      const firstCache = cachePlugin({ store: firstStore })
      const request = createClient({ baseURL: '/api' }).use(
        cachePlugin({ store: secondStore })
      )
      const config = {
        url: '/count',
        extensions: {
          cache: {
            enabled: true,
            key: 'authorization:Bearer browser-secret',
            ttl: Infinity
          }
        }
      }
      const nextMessage = () => new Promise<MessageEvent>(resolve => {
        secondChannel.addEventListener('message', resolve, { once: true })
      })
      const initialMessage = nextMessage()

      await firstCache.set(config, { version: 1, private: 'response-secret' }, {
        ttl: Infinity
      })
      await initialMessage
      const initial = await request.get(config.url, config)
      const updateMessage = nextMessage()

      await firstCache.set(config, { version: 2 }, { ttl: Infinity })
      const message = await updateMessage
      const updated = await request.get(config.url, config)

      firstStore.dispose()
      secondStore.dispose()
      firstChannel.close()
      secondChannel.close()
      await Promise.all([
        firstPersistent.close(),
        secondPersistent.close()
      ])
      indexedDB.deleteDatabase(databaseName)

      return {
        initial,
        updated,
        message: JSON.stringify(message.data)
      }
    })

    expect(result.initial).toEqual({
      version: 1,
      private: 'response-secret'
    })
    expect(result.updated).toEqual({ version: 2 })
    expect(result.message).not.toContain('browser-secret')
    expect(result.message).not.toContain('response-secret')
  }
)

test(
  'should coalesce tiered cache misses through a cross-context lease',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient,
        IndexedDBCacheStore,
        MemoryCacheStore,
        TieredCacheStore
      } = await import(moduleURL)
      const databaseName = `npora-lease-${crypto.randomUUID()}`
      const namespace = `npora-lease-${crypto.randomUUID()}`
      const firstPersistent = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'coalesced'
      })
      const secondPersistent = new IndexedDBCacheStore(indexedDB, {
        databaseName,
        namespace: 'coalesced'
      })
      const firstStore = new TieredCacheStore({
        primary: new MemoryCacheStore(),
        secondary: firstPersistent,
        coordination: { locks: navigator.locks, namespace }
      })
      const secondStore = new TieredCacheStore({
        primary: new MemoryCacheStore(),
        secondary: secondPersistent,
        coordination: { locks: navigator.locks, namespace }
      })
      const firstClient = createClient({ baseURL: '/api' }).use(
        cachePlugin({ store: firstStore })
      )
      const secondClient = createClient({ baseURL: '/api' }).use(
        cachePlugin({ store: secondStore })
      )
      const key = crypto.randomUUID()
      const url = `/count?cache=enabled&delay=100&key=${key}`
      const config = {
        extensions: {
          cache: {
            enabled: true,
            key: `private:${key}`,
            ttl: Infinity
          }
        }
      }
      const [first, second] = await Promise.all([
        firstClient.get(url, config),
        secondClient.get(url, config)
      ])

      firstStore.dispose()
      secondStore.dispose()
      await Promise.all([
        firstPersistent.close(),
        secondPersistent.close()
      ])
      indexedDB.deleteDatabase(databaseName)

      return { first, second }
    })

    expect(result).toEqual({
      first: { count: 1 },
      second: { count: 1 }
    })
  }
)

test(
  'should enforce the browser response size limit',
  async ({ page }) => {
    await openFixture(page)

    const code = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      try {
        await request.get('/download', {
          maxResponseSize: 1024,
          responseType: 'arrayBuffer'
        })
      } catch (error) {
        return (error as { code?: string }).code
      }

      return undefined
    })

    expect(code).toBe('RESPONSE_TOO_LARGE')
  }
)

test(
  'should parse server-sent events in the browser',
  async ({ page }) => {
    await openFixture(page)

    const events = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      const stream = await request.get<AsyncIterable<{
        data: string
        event: string
        id: string
      }>>(
        '/events',
        {
          responseType: 'sse'
        }
      )
      const events = []

      for await (const event of stream) {
        events.push(event)
      }

      return events
    })

    expect(events).toEqual([
      {
        data: '{"step":1}',
        event: 'ready',
        id: ''
      },
      {
        data: '{"step":2}',
        event: 'done',
        id: ''
      }
    ])
  }
)

test(
  'should parse NDJSON records in the browser',
  async ({ page }) => {
    await openFixture(page)

    const records = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      const stream = await request.get<AsyncIterable<{
        id: number
        name: string
      }>>('/records')
      const records = []

      for await (const record of stream) {
        records.push(record)
      }

      return records
    })

    expect(records).toEqual([
      { id: 1, name: '你好' },
      { id: 2, name: 'browser' }
    ])
  }
)

test(
  'should surface an interrupted browser response stream',
  async ({ page }) => {
    await openFixture(page)

    const failed = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      try {
        const stream = await request.get<ReadableStream<Uint8Array>>(
          '/stream-error',
          {
            responseType: 'stream'
          }
        )
        const reader = stream.getReader()

        while (!(await reader.read()).done) {
          // Consume until the transport reports the interruption.
        }

        return false
      } catch {
        return true
      }
    })

    expect(failed).toBe(true)
  }
)

test(
  'should enforce concurrency limits in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        concurrencyPlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(concurrencyPlugin({
        maxConcurrent: 1,
        maxQueue: 0
      }))
      const first = request.get('/slow')
      let code: string | undefined

      try {
        await request.get('/user')
      } catch (error) {
        code = (error as { code?: string }).code
      }

      await first

      return code
    })

    expect(result).toBe('CONCURRENCY_LIMIT')
  }
)

test(
  'should send HEAD and OPTIONS requests in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const browserWindow = window as BrowserWindow
      const request = browserWindow.nporaRequest

      if (!request) {
        throw new Error(
          'Npora request client is unavailable'
        )
      }

      const head = await request.headResponse('/user')
      const options = await request.options('/user')

      return {
        head: {
          data: head.data,
          status: head.status
        },
        options
      }
    })

    expect(result).toEqual({
      head: {
        data: undefined,
        status: 200
      },
      options: undefined
    })
  }
)

test(
  'should handle concurrent XHR download progress without Fetch',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        createClient,
        downloadPlugin
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(
        downloadPlugin({
          transport: 'xhr'
        })
      )
      let fetchCalls = 0
      const originalFetch = window.fetch

      window.fetch = (...args) => {
        fetchCalls += 1

        return originalFetch(...args)
      }

      try {
        const downloads = await Promise.all(
          Array.from({ length: 32 }, async (_, id) => {
            const events: Array<{
              loaded: number
              total?: number
              progress?: number
            }> = []
            const blob = await request.get(
              '/download',
              {
                query: {
                  id
                },
                extensions: {
                  download: {
                    onProgress(progress: {
                      loaded: number
                      total?: number
                      progress?: number
                    }) {
                      events.push(progress)
                    }
                  }
                }
              }
            )
            const last = events.at(-1)

            return {
              size: (blob as Blob).size,
              eventCount: events.length,
              loaded: last?.loaded,
              total: last?.total,
              progress: last?.progress
            }
          })
        )

        return {
          downloads,
          fetchCalls
        }
      } finally {
        window.fetch = originalFetch
      }
    })

    expect(result.fetchCalls).toBe(0)
    expect(result.downloads).toHaveLength(32)

    for (const download of result.downloads) {
      expect(download).toEqual({
        size: 64 * 1024,
        eventCount: expect.any(Number),
        loaded: 64 * 1024,
        total: 64 * 1024,
        progress: 1
      })
      expect(download.eventCount).toBeGreaterThan(0)
    }
  }
)

test(
  'should stream downloads with consumer-driven progress',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        createClient,
        downloadPlugin
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(downloadPlugin())
      const events: Array<{
        loaded: number
        total?: number
        progress?: number
        bytes?: number
      }> = []
      const stream = await request.get('/download', {
        extensions: {
          download: {
            output: 'stream',
            onProgress(progress: {
              loaded: number
              total?: number
              progress?: number
              bytes?: number
            }) {
              events.push(progress)
            }
          }
        }
      }) as ReadableStream<Uint8Array>

      const reader = stream.getReader()
      let received = 0

      while (true) {
        const chunk = await reader.read()

        if (chunk.done) {
          break
        }

        received += chunk.value.byteLength
      }

      return {
        received,
        eventCount: events.length,
        last: events.at(-1)
      }
    })

    expect(result.received).toBe(64 * 1024)
    expect(result.eventCount).toBeGreaterThan(0)
    expect(result.last).toMatchObject({
      loaded: 64 * 1024,
      total: 64 * 1024,
      progress: 1
    })
    expect(result.last?.bytes).toBeGreaterThan(0)
  }
)

test(
  'should handle concurrent native XHR upload progress',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        createClient,
        uploadPlugin
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(uploadPlugin())
      const originalFetch = window.fetch
      let fetchCalls = 0

      window.fetch = (...args) => {
        fetchCalls += 1

        return originalFetch(...args)
      }

      try {
        const uploads = await Promise.all(
          Array.from({ length: 32 }, async (_, id) => {
            const events: Array<{
              loaded: number
              total?: number
              progress?: number
            }> = []
            const data = await request.post('/upload', {
              query: {
                id
              },
              extensions: {
                upload: {
                  data: {
                    id,
                    file: new Blob([
                      new Uint8Array(64 * 1024)
                    ])
                  },
                  onProgress(progress: {
                    loaded: number
                    total?: number
                    progress?: number
                  }) {
                    events.push(progress)
                  }
                }
              }
            }) as {
              received: number
              contentType: string
            }
            const last = events.at(-1)

            return {
              received: data.received,
              contentType: data.contentType,
              eventCount: events.length,
              loaded: last?.loaded,
              total: last?.total,
              progress: last?.progress
            }
          })
        )

        return {
          uploads,
          fetchCalls
        }
      } finally {
        window.fetch = originalFetch
      }
    })

    expect(result.fetchCalls).toBe(0)
    expect(result.uploads).toHaveLength(32)

    for (const upload of result.uploads) {
      expect(upload.received).toBeGreaterThan(64 * 1024)
      expect(upload.contentType).toContain(
        'multipart/form-data; boundary='
      )
      expect(upload.eventCount).toBeGreaterThan(0)
      expect(upload.loaded).toBe(upload.total)
      expect(upload.progress).toBe(1)
    }
  }
)

async function openFixture(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.goto('/')

  await page.waitForFunction(() => {
    const browserWindow = window as BrowserWindow

    return (
      browserWindow.nporaReady === true ||
      typeof browserWindow.nporaError === 'string'
    )
  })

  const initializationError = await page.evaluate(() => {
    const browserWindow = window as BrowserWindow

    return browserWindow.nporaError
  })

  expect(initializationError).toBeUndefined()
}
