import { describe, expect, it, vi } from 'vitest'
import { authPlugin, cachePlugin, createClient, retryPlugin } from '../src'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const readOptions = {
  extensions: { cache: { enabled: true, ttl: 60_000, tags: ['catalog'] } }
} as const
const json = (value: unknown, status = 200) => Response.json(value, { status })

describe.each(['auth-first', 'cache-first'] as const)('%s session composition', order => {
  function session(fetch: typeof globalThis.fetch, auth: ReturnType<typeof authPlugin>) {
    const cache = cachePlugin()
    const client = createClient({ baseURL: 'https://example.test', fetch })
    if (order === 'auth-first') client.use(auth).use(cache)
    else client.use(cache).use(auth)
    client.use(retryPlugin({ retries: 2, delay: 0 }))
    return { client, cache }
  }

  it('keeps a shared leader alive when a follower cancels during refresh and retry', async () => {
    const refresh = deferred<string>()
    const enteredRefresh = deferred<void>()
    let token = 'expired'
    let authorizedAttempts = 0
    const headers: Array<string | null> = []
    const refreshToken = vi.fn(() => {
      enteredRefresh.resolve()
      return refresh.promise
    })
    const fetch = vi.fn(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('authorization')
      headers.push(authorization)
      if (authorization === 'Bearer expired') return json({}, 401)
      return ++authorizedAttempts === 1 ? json({}, 503) : json({ owner: 'A' })
    })
    const { client, cache } = session(fetch, authPlugin({
      token: () => token,
      storage: { get: () => token, set: value => { token = value }, remove() {} },
      refreshToken
    }))
    const leader = client.get('/catalog', readOptions)
    await enteredRefresh.promise
    const controller = new AbortController()
    const follower = client.get('/catalog', { ...readOptions, signal: controller.signal })
    const cancelled = expect(follower).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await vi.waitFor(() => expect(cache.getStats().deduplicated).toBe(1))
    controller.abort()
    await cancelled
    refresh.resolve('fresh')
    await expect(leader).resolves.toEqual({ owner: 'A' })
    expect(refreshToken).toHaveBeenCalledOnce()
    expect(headers).toEqual(['Bearer expired', 'Bearer fresh', 'Bearer fresh'])
    // Cache identity is captured before refresh; warm the new credential's key.
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ owner: 'A' })
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ owner: 'A' })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('shares refresh across distinct URLs while one caller cancels', async () => {
    const refresh = deferred<string>()
    const enteredRefresh = deferred<void>()
    let token = 'expired'
    const set = vi.fn((value: string) => { token = value })
    const refreshToken = vi.fn(() => {
      enteredRefresh.resolve()
      return refresh.promise
    })
    const fetch = vi.fn(async (_input, init) => (
      new Headers(init?.headers).get('authorization') === 'Bearer fresh'
        ? json({ ok: true }) : json({}, 401)
    ))
    const shouldRefresh = vi.fn(async () => true)
    const { client } = session(fetch, authPlugin({
      storage: { get: () => token, set, remove() {} },
      refreshToken, shouldRefresh
    }))
    const controller = new AbortController()
    const first = client.get('/first', { ...readOptions, signal: controller.signal })
    const cancelled = expect(first).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await enteredRefresh.promise
    const second = client.get('/second', readOptions)
    await vi.waitFor(() => expect(shouldRefresh).toHaveBeenCalledTimes(2))
    controller.abort()
    await cancelled
    refresh.resolve('fresh')
    await expect(second).resolves.toEqual({ ok: true })
    expect(refreshToken).toHaveBeenCalledOnce()
    expect(set).toHaveBeenCalledExactlyOnceWith('fresh')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('counts auth replay toward the ordinary retry attempt budget', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValue(json({ recovered: true }))
    const refreshToken = vi.fn(async () => 'fresh')
    const { client } = session(fetch, authPlugin({ token: 'session', refreshToken }))
    const limited = { ...readOptions, extensions: { ...readOptions.extensions, retry: 1 } }
    await expect(client.get('/catalog', limited)).rejects.toMatchObject({ status: 503 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(refreshToken).toHaveBeenCalledOnce()
    // A failed chain must not leave a cache entry or an in-flight leader.
    await expect(client.get('/catalog', limited)).resolves.toEqual({ recovered: true })
    await expect(client.get('/catalog', limited)).resolves.toEqual({ recovered: true })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not restore credentials or populate cache when logout interrupts refresh', async () => {
    const refresh = deferred<string>()
    const enteredRefresh = deferred<void>()
    let token: string | undefined = 'expired'
    const set = vi.fn((value: string) => { token = value })
    const fetch = vi.fn(async () => json({}, 401))
    const { client, cache } = session(fetch, authPlugin({
      storage: { get: () => token, set, remove: () => { token = undefined } },
      refreshToken: () => { enteredRefresh.resolve(); return refresh.promise }
    }))
    const controller = new AbortController()
    const pending = client.get('/catalog', { ...readOptions, signal: controller.signal })
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await enteredRefresh.promise
    controller.abort('logout')
    client.unuse('auth').unuse('retry').unuse('cache')
    await cache.clear()
    token = undefined
    await cancelled
    refresh.resolve('late-token')
    await refresh.promise
    // Drain the refresh storage continuation, not a wall-clock delay.
    await Promise.resolve()
    expect(set).not.toHaveBeenCalled()
    expect(token).toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    // A new session may reuse this cache instance after clear, without old data.
    client.use(authPlugin({ token: 'account-B' })).use(cache)
    fetch.mockImplementation(async () => json({ owner: 'B' }))
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ owner: 'B' })
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ owner: 'B' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves cached data after exhausted mutation retries and invalidates after final success', async () => {
    let reads = 0
    let writes = 0
    let fail = true
    const refreshToken = vi.fn(async () => 'session')
    const fetch = vi.fn(async (_input, init) => {
      if (init?.method === 'GET') return json({ version: ++reads })
      writes++
      // Both logical mutations must refresh, then apply normal retry policy.
      if (writes === 1 || writes === 4) return json({}, 401)
      return fail ? json({}, 503) : json({ updated: true })
    })
    const { client } = session(fetch, authPlugin({ token: 'session', refreshToken }))
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ version: 1 })
    const mutation = {
      json: { name: 'Updated' },
      extensions: { cache: { invalidateTags: ['catalog'] } }
    }
    await expect(client.put('/catalog', mutation)).rejects.toMatchObject({
      code: 'HTTP_ERROR', status: 503
    })
    expect(writes).toBe(3)
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ version: 1 })
    expect(reads).toBe(1)
    fail = false
    await expect(client.put('/catalog', mutation)).resolves.toEqual({ updated: true })
    expect(writes).toBe(5)
    expect(refreshToken).toHaveBeenCalledTimes(2)
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ version: 2 })
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ version: 2 })
    expect(reads).toBe(2)
  })

  it('releases shared failures after refresh rejection so a later request can recover', async () => {
    const refresh = deferred<string>()
    const enteredRefresh = deferred<void>()
    let token = 'expired'
    const refreshToken = vi.fn()
      .mockImplementationOnce(() => { enteredRefresh.resolve(); return refresh.promise })
      .mockImplementationOnce(async () => { token = 'fresh'; return token })
    const fetch = vi.fn(async (_input, init) => (
      new Headers(init?.headers).get('authorization') === 'Bearer fresh'
        ? json({ recovered: true }) : json({}, 401)
    ))
    const { client, cache } = session(fetch, authPlugin({ token: () => token, refreshToken }))
    const leader = client.get('/catalog', readOptions)
    const first = expect(leader).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 })
    await enteredRefresh.promise
    const follower = client.get('/catalog', readOptions)
    const second = expect(follower).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 })
    await vi.waitFor(() => expect(cache.getStats().deduplicated).toBe(1))
    refresh.reject(new Error('refresh unavailable'))
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledOnce()
    await expect(client.get('/catalog', readOptions)).resolves.toEqual({ recovered: true })
    expect(refreshToken).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
