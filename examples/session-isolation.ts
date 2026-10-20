import assert from 'node:assert/strict'
import { createClient, isRequestError } from '../src/core-entry'
import { authPlugin } from '../src/plugins/authPlugin'
import { cachePlugin } from '../src/plugins/cachePlugin'

interface Profile { account: string }
const refreshes = new Map<string, number>()
const reads = new Map<string, number>()
let startPending!: () => void
const pendingStarted = new Promise<void>(resolve => { startPending = resolve })
let releaseRefresh!: () => void
const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve })
let startRefresh!: () => void
const refreshStarted = new Promise<void>(resolve => { startRefresh = resolve })

const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  if (path === '/refresh') {
    const { account } = JSON.parse(String(init?.body)) as Profile
    refreshes.set(account, (refreshes.get(account) ?? 0) + 1)
    startRefresh()
    await refreshGate
    return Response.json({ token: `${account}:fresh` })
  }
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '')
  if (!token?.endsWith(':fresh')) return Response.json({ message: 'Expired' }, { status: 401 })
  const account = token.slice(0, -':fresh'.length)
  if (path === '/pending') {
    const signal = init?.signal
    assert.ok(signal)
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      startPending()
    })
  }
  reads.set(account, (reads.get(account) ?? 0) + 1)
  return Response.json({ account })
}

function createSession(account: string, initialToken: string) {
  let token: string | undefined = initialToken
  let closed = false
  const controller = new AbortController()
  const inFlight = new Set<Promise<unknown>>()
  const cache = cachePlugin({ maxEntries: 10 })
  // Session aborts can stop refresh; an individual view's signal cannot.
  const refreshApi = createClient({
    baseURL: 'https://example.test', fetch: fixtureFetch,
    signal: controller.signal, timeout: 1000
  })
  const api = refreshApi.extend().use(authPlugin({
    storage: {
      get: () => token,
      set: value => { token = value },
      remove: () => { token = undefined }
    },
    async refreshToken() {
      const result = await refreshApi.post<{ token: string }>('/refresh', { json: { account } })
      return result.token
    }
  })).use(cache)

  function read(path: string, viewSignal?: AbortSignal, cached = false) {
    if (closed) return Promise.reject(new Error('Session is closed'))
    const pending = api.get<Profile>(path, {
      signal: viewSignal
        ? AbortSignal.any([controller.signal, viewSignal])
        : controller.signal,
      extensions: { cache: { enabled: cached, ttl: 60000 } }
    })
    inFlight.add(pending)
    void pending.then(() => inFlight.delete(pending), () => inFlight.delete(pending))
    return pending
  }
  return {
    profile: (signal?: AbortSignal) => read('/profile', signal, true),
    settings: () => read('/settings'),
    pending: (signal: AbortSignal) => read('/pending', signal),
    hasToken: () => token !== undefined,
    async logout() {
      if (closed) return
      closed = true
      controller.abort()
      await Promise.allSettled([...inFlight])
      try { await cache.clear() } finally {
        token = undefined
        api.unuse('cache').unuse('auth')
      }
    }
  }
}

const alice = createSession('alice', 'alice:expired')
const bob = createSession('bob', 'bob:fresh')
try {
  // Different URLs cannot be deduplicated by the HTTP cache; auth must share refresh.
  const profile = alice.profile()
  const settings = alice.settings()
  await refreshStarted
  releaseRefresh()
  assert.deepEqual(await Promise.all([profile, settings]), [
    { account: 'alice' }, { account: 'alice' }
  ])
  assert.equal(refreshes.get('alice'), 1)

  // Warm Alice under the fresh credential, then verify each session's hot cache.
  await alice.profile()
  assert.deepEqual(await bob.profile(), { account: 'bob' })
  const aliceReads = reads.get('alice')
  const bobReads = reads.get('bob')
  assert.deepEqual(await alice.profile(), { account: 'alice' })
  assert.deepEqual(await bob.profile(), { account: 'bob' })
  assert.equal(reads.get('alice'), aliceReads)
  assert.equal(reads.get('bob'), bobReads)

  const view = new AbortController()
  const pending = alice.pending(view.signal)
  const cancelled = assert.rejects(pending,
    error => isRequestError(error) && error.code === 'ABORT_ERROR')
  await pendingStarted
  // Logout must cancel even a request that received a separate view signal.
  await alice.logout()
  await cancelled
  assert.equal(view.signal.aborted, false)
  assert.equal(alice.hasToken(), false)
  await assert.rejects(alice.profile(), /Session is closed/)

  // The old session's cancellation and cleanup do not affect the new session.
  assert.equal(bob.hasToken(), true)
  assert.deepEqual(await bob.profile(), { account: 'bob' })
  assert.equal(reads.get('bob'), bobReads)
  console.log('Session isolation passed: shared refresh, private caches, logout cancellation, and independent accounts.')
} finally {
  releaseRefresh()
  await Promise.all([alice.logout(), bob.logout()])
}
assert.equal(bob.hasToken(), false)
