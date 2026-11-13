import { describe, expect, it, vi } from 'vitest'
import { authPlugin, cachePlugin, createClient, MemoryCacheStore } from '../src'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('staggered authentication responses', () => {
  it.each([
    ['storage', false], ['storage', true], ['plugin', true], ['request', true]
  ] as const)('reuses a rotated credential (%s, async: %s)', async (source, asynchronous) => {
    const entered = deferred<void>()
    const release = deferred<void>()
    let token = 'old'
    const refreshToken = vi.fn(() => 'fresh')
    const fetch = vi.fn(async (input, init) => {
      const header = new Headers(init?.headers).get('authorization')
      if (header === 'Token old') {
        if (String(input).endsWith('/slow')) {
          entered.resolve()
          await release.promise
        }
        return Response.json({}, { status: 401 })
      }
      return Response.json({ ok: true })
    })
    const provider = () => asynchronous ? Promise.resolve(token) : token
    const client = createClient({ fetch }).use(authPlugin({
      scheme: 'Token',
      ...(source === 'plugin' ? { token: provider } : {}),
      storage: {
        get: provider,
        set: value => { token = value }, remove() {}
      }, refreshToken
    }))
    const config = source === 'request'
      ? { extensions: { auth: { token: provider, scheme: 'Token' } } } : {}
    const slow = client.get('https://example.test/slow', config)
    await entered.promise
    await client.get('https://example.test/fast')
    release.resolve()
    await expect(slow).resolves.toEqual({ ok: true })
    expect(refreshToken).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('refreshes again when a new request using the current credential is rejected', async () => {
    let token = 'old'
    let freshRejected = false
    const refreshToken = vi.fn(() => token === 'old' ? 'fresh' : 'newer')
    const fetch = vi.fn(async (_input, init) => {
      const header = new Headers(init?.headers).get('authorization')
      return header === 'Bearer old' || (freshRejected && header === 'Bearer fresh')
        ? Response.json({}, { status: 401 }) : Response.json({ ok: true })
    })
    const client = createClient({ fetch }).use(authPlugin({ storage: {
      get: () => token, set: value => { token = value }, remove() {}
    }, refreshToken }))
    await client.get('https://example.test/first')
    freshRejected = true
    await client.get('https://example.test/second')
    expect(refreshToken).toHaveBeenCalledTimes(2)
    expect(token).toBe('newer')
  })

  it.each(['abort', 'remove', 'logout'] as const)('does not replay after %s during a delayed credential lookup', async action => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const lookup = deferred<string>()
    const lookupEntered = deferred<void>()
    let token = 'old'
    let reads = 0
    const refreshToken = vi.fn(() => 'fresh')
    const fetch = vi.fn(async (input, init) => {
      if (new Headers(init?.headers).get('authorization') === 'Bearer old') {
        if (String(input).endsWith('/slow')) {
          entered.resolve()
          await release.promise
        }
        return Response.json({}, { status: 401 })
      }
      return Response.json({ ok: true })
    })
    const client = createClient({ fetch }).use(authPlugin({ storage: {
      get: () => {
        if (++reads === 3) { lookupEntered.resolve(); return lookup.promise }
        return token
      },
      set: value => { token = value }, remove() {}
    }, refreshToken }))
    const controller = new AbortController()
    const slow = client.get('https://example.test/slow', { signal: controller.signal })
    const failure = expect(slow).rejects.toMatchObject(action === 'abort'
      ? { code: 'ABORT_ERROR' } : { code: 'HTTP_ERROR', status: 401 })
    await entered.promise
    await client.get('https://example.test/fast')
    release.resolve()
    await lookupEntered.promise
    if (action === 'abort') controller.abort()
    if (action === 'remove') client.unuse('auth')
    lookup.resolve(action === 'logout' ? '' : token)
    await failure
    expect(refreshToken).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each(['auth-first', 'cache-first'])('does not cache refreshed data under an expired identity (%s)', async order => {
    let token = 'old'
    const store = new MemoryCacheStore()
    const fetch = vi.fn(async (_input, init) =>
      new Headers(init?.headers).get('authorization') === 'Bearer old'
        ? Response.json({}, { status: 401 }) : Response.json({ owner: 'A' }))
    const auth = authPlugin({ storage: {
      get: () => token, set: value => { token = value }, remove() {}
    }, refreshToken: () => 'fresh' })
    const cache = cachePlugin({ store })
    const client = createClient({ fetch })
    if (order === 'auth-first') client.use(auth).use(cache)
    else client.use(cache).use(auth)
    const options = { extensions: { cache: { enabled: true, ttl: 60_000 } } }
    await client.get('https://example.test/profile', options)
    // The refreshed response must not populate the old credential's key.
    token = 'old'
    await client.get('https://example.test/profile', options)
    expect(fetch).toHaveBeenCalledTimes(4)
    await client.get('https://example.test/profile', options)
    await client.get('https://example.test/profile', options)
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('does not restore an old-identity stale response after refresh and a server failure', async () => {
    let token = 'old'
    let warm = true
    const fetch = vi.fn(async () => warm
      ? Response.json({ owner: 'old' })
      : Response.json({}, { status: token === 'old' ? 401 : 503 }))
    const client = createClient({ fetch }).use(authPlugin({ storage: {
      get: () => token, set: value => { token = value }, remove() {}
    }, refreshToken: () => 'fresh' })).use(cachePlugin())
    const options = { extensions: { cache: { enabled: true, ttl: 1, staleIfError: 60_000 } } }
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      await client.get('https://example.test/profile', options)
      warm = false
      now.mockReturnValue(1010)
      await expect(client.get('https://example.test/profile', options))
        .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 })
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally {
      now.mockRestore()
    }
  })

  it.each(['auth-first', 'cache-first'])('retains the initial generation across a shared-cache wait (%s)', async order => {
    const entered = deferred<void>()
    const release = deferred<string>()
    let token = 'old'
    const refreshToken = vi.fn(() => { entered.resolve(); return release.promise })
    const auth = authPlugin({ storage: {
      get: () => token, set: value => { token = value }, remove() {}
    }, refreshToken })
    const cache = cachePlugin()
    const fetch = vi.fn(async (_input, init) =>
      new Headers(init?.headers).get('authorization') === 'Bearer old'
        ? Response.json({}, { status: 401 }) : Response.json({ ok: true }))
    const client = createClient({ fetch })
    if (order === 'auth-first') client.use(auth).use(cache)
    else client.use(cache).use(auth)
    const options = { extensions: { cache: { enabled: true, ttl: 60_000 } } }
    const leader = client.get('https://example.test/profile', options)
    await entered.promise
    const follower = client.get('https://example.test/profile', options)
    await vi.waitFor(() => expect(cache.getStats().deduplicated).toBe(1))
    release.resolve('fresh')
    await expect(Promise.all([leader, follower])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(refreshToken).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
