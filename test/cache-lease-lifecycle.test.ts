import { describe, expect, it, vi } from 'vitest'
import { cachePlugin, createClient, type CacheRefreshLease, type CacheStore } from '../src'

describe('cache refresh lease ownership', () => {
  it('observes a late rejected acquisition when the store aborts synchronously', async () => {
    const controller = new AbortController()
    const store: CacheStore = {
      get() { return undefined }, set() {}, delete() {}, clear() {},
      acquireRefreshLease() {
        controller.abort()
        return Promise.reject(new Error('late lock failure'))
      }
    }
    const fetchMock = vi.fn()
    const request = createClient({ fetch: fetchMock }).use(cachePlugin({ store }))

    await expect(request.get('/lease', {
      signal: controller.signal,
      extensions: { cache: { enabled: true } }
    })).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels the store reread after acquiring a lease and releases the lease', async () => {
    let entered!: () => void
    const rereading = new Promise<void>(resolve => { entered = resolve })
    const release = vi.fn()
    const get = vi.fn().mockReturnValueOnce(undefined).mockImplementation(() => {
      entered()
      return new Promise<never>(() => {})
    })
    const store: CacheStore = {
      get, set() {}, delete() {}, clear() {},
      async acquireRefreshLease() { return { contended: true, release } }
    }
    const fetchMock = vi.fn()
    const request = createClient({ fetch: fetchMock }).use(cachePlugin({ store }))
    const controller = new AbortController()
    const pending = request.get('/lease', {
      signal: controller.signal,
      extensions: { cache: { enabled: true } }
    })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await rereading
    controller.abort()
    await rejected
    expect(release).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['abort', 'remove'] as const)('releases a lease granted after %s', async action => {
    let grant!: (lease: CacheRefreshLease) => void
    const acquisition = new Promise<CacheRefreshLease>(resolve => { grant = resolve })
    const release = vi.fn()
    const acquireRefreshLease = vi.fn(() => acquisition)
    const store: CacheStore = {
      get() { return undefined }, set() {}, delete() {}, clear() {}, acquireRefreshLease
    }
    const fetchMock = vi.fn(async () => new Response('OK'))
    const request = createClient({ fetch: fetchMock }).use(cachePlugin({ store }))
    const controller = new AbortController()
    const pending = request.get('/lease', {
      signal: controller.signal,
      extensions: { cache: { enabled: true } }
    })
    expect(acquireRefreshLease).toHaveBeenCalledTimes(1)
    const outcome = action === 'abort'
      ? expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
      : expect(pending).resolves.toBe('OK')

    if (action === 'abort') {
      controller.abort()
      await outcome
    } else {
      request.unuse('cache')
    }
    grant({ contended: false, release })
    await acquisition
    await outcome
    // Flush the lease ownership and cancellation continuations.
    await Promise.resolve()
    expect(release).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(action === 'abort' ? 0 : 1)
  })
})
