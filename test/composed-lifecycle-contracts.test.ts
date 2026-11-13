import { afterEach, describe, expect, it, vi } from 'vitest'
import { authPlugin, cachePlugin, createClient, downloadPlugin, MemoryCacheStore,
  openTelemetryMetricsPlugin, openTelemetryPlugin, TieredCacheStore, type CacheEntry } from '../src'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const cacheOptions = { extensions: { cache: { enabled: true, ttl: 60_000, tags: ['profile'] } } }
const url = 'https://example.test/profile'
const entry = (data: unknown): CacheEntry => ({ data, expiresAt: Infinity, status: 200, statusText: 'OK', headers: [], tags: ['profile'] })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('stream metrics preserve iterator cleanup', () => {
  it.each(['ndjson', 'sse'].flatMap(format => ['unopened', 'read', 'schema'].flatMap(stage =>
    ['return', 'throw'].map(close => ({ format, stage, close })))))('$format $stage $close', async ({ format, stage, close }) => {
    vi.useFakeTimers()
    let active = 0
    const cancelled = vi.fn()
    const validation = deferred<{ value: unknown }>()
    const entered = deferred()
    const instrument = { add() {}, record() {} }
    const api = createClient({ totalTimeout: 10_000, fetch: async () => new Response(new ReadableStream({
      start(controller) {
        if (stage === 'schema') controller.enqueue(new TextEncoder().encode(format === 'sse' ? 'data: hi\n\n' : '{"id":1}\n'))
      }, cancel: cancelled
    })) }).use(openTelemetryMetricsPlugin({ meter: {
      createCounter: () => instrument, createHistogram: () => instrument,
      createUpDownCounter: name => ({ add(value) { if (name === 'npora.client.active_streams') active += value } })
    } }))
    const itemSchema = { '~standard': { version: 1 as const, vendor: 'test', validate() {
      entered.resolve(); return validation.promise
    } } }
    const stream = await api[format as 'ndjson'](url, stage === 'schema' ? { itemSchema } : {})
    const iterator = stream[Symbol.asyncIterator]()
    const reading = stage === 'unopened' ? undefined : iterator.next()
    if (stage === 'schema') await entered.promise
    await vi.advanceTimersByTimeAsync(0)
    const error = new Error('consumer stopped')
    if (close === 'return') await expect(iterator.return!('done')).resolves.toEqual({ done: true, value: 'done' })
    else await expect(iterator.throw!(error)).rejects.toBe(error)
    if (reading) await expect(reading).resolves.toMatchObject({ done: true })
    expect(cancelled).toHaveBeenCalledOnce()
    expect(active).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    validation.resolve({ value: 'late' })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
  })
})

describe('cache mutation ordering', () => {
  it('orders a tiered clear between older and newer asynchronous writes', async () => {
    const entered = deferred(), release = deferred()
    const primary = new MemoryCacheStore()
    const values = new Map<string, CacheEntry>()
    let writes = 0
    const store = new TieredCacheStore({ primary, secondary: {
      get: key => values.get(key),
      async set(key, value) { if (++writes === 1) { entered.resolve(); await release.promise }; values.set(key, value) },
      delete(key) { values.delete(key) }, clear() { values.clear() }
    } })
    const old = store.set('profile', entry('old'))
    await entered.promise
    const cleared = store.clear()
    const next = store.set('profile', entry('new'))
    release.resolve()
    await Promise.all([old, cleared, next])
    expect(primary.get('profile')?.data).toBe('new')
    expect(values.get('profile')?.data).toBe('new')
  })
  it.each(['clear', 'delete', 'tags'] as const)('orders %s after an asynchronous network write', async mutation => {
    const entered = deferred(), release = deferred()
    const values = new Map<string, CacheEntry>()
    let writes = 0, transports = 0
    const cache = cachePlugin({ store: {
      get: key => values.get(key),
      async set(key, value) { if (++writes === 1) { entered.resolve(); await release.promise }; values.set(key, value) },
      delete(key) { values.delete(key) }, clear() { values.clear() },
      invalidateTags() { const size = values.size; values.clear(); return size }
    } })
    const api = createClient({ fetch: async () => Response.json({ transport: ++transports }) }).use(cache)
    const original = api.get(url, cacheOptions)
    await entered.promise
    const invalidation = mutation === 'clear' ? cache.clear() : mutation === 'delete'
      ? cache.delete({ url, method: 'GET', ...cacheOptions }) : cache.invalidateTags('profile')
    release.resolve()
    await original
    await invalidation
    expect(values.size).toBe(0)
    await expect(api.get(url, cacheOptions)).resolves.toEqual({ transport: 2 })
  })

  it('makes new requests wait for a clear barrier before reading the store', async () => {
    const entered = deferred(), release = deferred()
    let value: CacheEntry | undefined = entry({ stale: true })
    const cache = cachePlugin({ store: {
      get: () => value, set(_key, next) { value = next }, delete() { value = undefined },
      async clear() { entered.resolve(); await release.promise; value = undefined }
    } })
    const fetch = vi.fn(async () => Response.json({ fresh: true }))
    const api = createClient({ fetch }).use(cache)
    const cleared = cache.clear()
    await entered.promise
    const next = api.get(url, cacheOptions)
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    release.resolve()
    await cleared
    await expect(next).resolves.toEqual({ fresh: true })
  })

  it.each(['clear', 'delete', 'set', 'tags'] as const)('does not promote a stale tiered read after %s', async mutation => {
    const entered = deferred(), release = deferred()
    const primary = new MemoryCacheStore()
    let value: CacheEntry | undefined = entry('old')
    const secondary = {
      async get() { const snapshot = value; entered.resolve(); await release.promise; return snapshot },
      set(_key: string, next: CacheEntry) { value = next }, delete() { value = undefined }, clear() { value = undefined },
      invalidateTags() { value = undefined; return 1 }
    }
    const store = new TieredCacheStore({ primary, secondary })
    const reading = store.get('profile')
    await entered.promise
    if (mutation === 'clear') await store.clear()
    else if (mutation === 'delete') await store.delete('profile')
    else if (mutation === 'tags') await store.invalidateTags(['profile'])
    else await store.set('profile', entry('new'))
    release.resolve()
    await expect(reading).resolves.toBeUndefined()
    expect(primary.get('profile')?.data).toBe(mutation === 'set' ? 'new' : undefined)
  })
})

describe('conditional cache authentication', () => {
  it.each(['auth-first', 'cache-first'])('drops owned validators after refresh (%s)', async order => {
    let token = 'old', warm = true
    const validators: Array<string | null> = []
    const fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers)
      validators.push(headers.get('if-none-match'))
      if (warm) return Response.json({ owner: 'A' }, { headers: { etag: '"v1"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' } })
      if (headers.get('authorization') === 'Bearer old') return Response.json({}, { status: 401 })
      if (headers.has('if-none-match') || headers.has('if-modified-since')) return new Response(null, { status: 304 })
      return Response.json({ owner: 'A' })
    })
    const auth = authPlugin({ storage: { get: () => token, set: value => { token = value }, remove() {} }, refreshToken: () => 'fresh' })
    const api = createClient({ fetch })
    if (order === 'auth-first') api.use(auth).use(cachePlugin())
    else api.use(cachePlugin()).use(auth)
    await api.get(url, cacheOptions)
    warm = false
    await expect(api.get(url, { ...cacheOptions, headers: { 'cache-control': 'no-cache' },
      validateStatus: status => status === 200 })).resolves.toEqual({ owner: 'A' })
    expect(validators).toEqual([null, '"v1"', null])
  })

  it('keeps application-owned validators during an auth replay', async () => {
    let token = 'old'
    const headers: Array<string | null> = []
    const api = createClient({ fetch: async (_input, init) => {
      const request = new Headers(init?.headers)
      headers.push(request.get('if-none-match'))
      return request.get('authorization') === 'Bearer old' ? Response.json({}, { status: 401 }) : new Response(null, { status: 304 })
    } }).use(authPlugin({ storage: { get: () => token, set: value => { token = value }, remove() {} }, refreshToken: () => 'fresh' })).use(cachePlugin())
    await expect(api.getResponse(url, { ...cacheOptions, headers: { 'if-none-match': '"application"' },
      validateStatus: status => status === 200 || status === 304 })).resolves.toMatchObject({ status: 304 })
    expect(headers).toEqual(['"application"', '"application"'])
  })
})

describe('transport and cache policy contracts', () => {
  it.each([false, true])('rejects a native Request body before XHR dispatch (opaque=%s)', async opaque => {
    const send = vi.fn()
    vi.stubGlobal('XMLHttpRequest', class {
      upload = {}; open() {}; setRequestHeader() {}; abort() {}; send = send
    })
    const input = new Request(url, { method: 'POST', body: 'payload' })
    if (opaque) Object.defineProperty(input, 'body', { value: undefined })
    const api = createClient().use(downloadPlugin({ transport: 'xhr' }))
    await expect(api.request(input, { extensions: { download: { onProgress() {} } } })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(send).not.toHaveBeenCalled()
    expect(input.bodyUsed).toBe(false)
  })

  it.each([206, 404, 503])('does not persist accepted HTTP %s by default', async status => {
    const fetch = vi.fn().mockImplementationOnce(() => Response.json({ stale: true }, { status }))
      .mockImplementation(() => Response.json({ fresh: true }))
    const api = createClient({ fetch, throwHttpErrors: false }).use(cachePlugin())
    await api.get(url, cacheOptions)
    await expect(api.get(url, cacheOptions)).resolves.toEqual({ fresh: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('lets explicitly configured HTTP statuses persist', async () => {
    const fetch = vi.fn(async () => Response.json({ missing: true }, { status: 404 }))
    const api = createClient({ fetch, throwHttpErrors: false }).use(cachePlugin({ statusCodes: [200, 404] }))
    await api.get(url, cacheOptions)
    await expect(api.get(url, cacheOptions)).resolves.toEqual({ missing: true })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([null, [199], [600], [200.5]])('rejects invalid cache status policies: %j', statusCodes => {
    expect(() => cachePlugin({ statusCodes: statusCodes as never })).toThrow(expect.objectContaining({ code: 'CONFIG_ERROR' }))
  })

  it('uses the same base path for transport and trace URLs', async () => {
    let spanURL: unknown, transportURL: unknown
    const api = createClient({ baseURL: 'https://example.test/api', fetch: async input => {
      transportURL = input; return Response.json({ ok: true })
    } }).use(openTelemetryPlugin({
      tracer: { startSpan(_name, options) {
        spanURL = options?.attributes?.['url.full']
        return { setAttribute() { return this }, setStatus() { return this }, recordException() {}, end() {} }
      } }, context: { active() { return {} } }, trace: { setSpan: context => context }, propagation: { inject() {} }
    }))
    await api.get('/users')
    expect(transportURL).toBe('https://example.test/api/users')
    expect(spanURL).toBe(transportURL)
  })
})
