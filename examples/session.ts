import assert from 'node:assert/strict'
import { createClient, isRequestError } from '../src/core-entry'
import { authPlugin, type AuthTokenStorage } from '../src/plugins/authPlugin'
import { cachePlugin } from '../src/plugins/cachePlugin'
import { retryPlugin } from '../src/plugins/retryPlugin'

interface Item {
  id: number
  name: string
}

// One session owns its token storage, clients, and cache. No external server
// or credentials are needed; replace fixtureFetch with Fetch in an application.
let accessToken: string | undefined = 'expired-token'
let refreshCalls = 0
let catalogReads = 0
let item: Item = { id: 1, name: 'Notebook' }
let notifyPending!: () => void
const pendingStarted = new Promise<void>(resolve => { notifyPending = resolve })
const storage: AuthTokenStorage = {
  get: () => accessToken,
  set: token => { accessToken = token },
  remove: () => { accessToken = undefined }
}

const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  if (path === '/session/refresh') {
    refreshCalls += 1
    return json({ accessToken: 'fresh-token' })
  }

  if (path === '/catalog') catalogReads += init?.method === 'GET' ? 1 : 0
  if (new Headers(init?.headers).get('authorization') !== 'Bearer fresh-token') {
    return json({ message: 'Expired session' }, 401)
  }

  if (path === '/pending') {
    const signal = init?.signal
    assert.ok(signal)
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      notifyPending()
    })
  }

  if (path === '/catalog' && init?.method === 'POST') {
    const update = JSON.parse(String(init.body)) as { name: string }
    if (!update.name) return json({ message: 'Name is required' }, 422)
    item = { ...item, name: update.name }
    return json(item)
  }
  if (path === '/catalog') {
    // The first authorized read fails transiently; the retry then succeeds.
    return catalogReads === 2
      ? json({ message: 'Temporarily unavailable' }, 503)
      : json([item])
  }
  return json({ message: 'Not found' }, 404)
}

const sessionApi = createClient({
  baseURL: 'https://example.test',
  fetch: fixtureFetch,
  timeout: 1000,
  totalTimeout: 5000
})
const cache = cachePlugin({ maxEntries: 50 })
// extend() inherits configuration and the adapter. Install each session's
// plugins explicitly; registrations are not inherited from the parent.
const api = sessionApi.extend()
  .use(authPlugin({
    storage,
    async refreshToken() {
      // This separate client cannot recursively trigger auth refresh.
      const session = await sessionApi.post<{ accessToken: string }>('/session/refresh')
      return session.accessToken
    }
  }))
  .use(retryPlugin({ retries: 2, delay: 0 }))
  .use(cache)
const readOptions = {
  extensions: { cache: { enabled: true, ttl: 60_000, tags: ['catalog'] } }
}

try {
  const first = await api.get<Item[]>('/catalog', readOptions)
  assert.deepEqual(first, [{ id: 1, name: 'Notebook' }])
  assert.equal(refreshCalls, 1)
  assert.equal(catalogReads, 3)
  assert.equal(accessToken, 'fresh-token')
  // Refresh changes the authorization header. Warm the cache under the fresh
  // credential before checking reuse; credentials participate in cache keys.
  assert.deepEqual(await api.get('/catalog', readOptions), first)
  assert.equal(catalogReads, 4)
  assert.deepEqual(await api.get('/catalog', readOptions), first)
  assert.equal(catalogReads, 4)
  console.log('1. Refreshed credentials, retried a transient failure, and cached the list.')

  // Failed writes preserve the cached list. POST is not retried by default.
  await assert.rejects(api.post('/catalog', {
    json: { name: '' },
    extensions: { cache: { invalidateTags: ['catalog'] } }
  }), error => isRequestError(error) && error.status === 422)
  assert.deepEqual(await api.get('/catalog', readOptions), first)
  assert.equal(catalogReads, 4)

  await api.post('/catalog', {
    json: { name: 'Updated notebook' },
    extensions: { cache: { invalidateTags: ['catalog'] } }
  })
  assert.deepEqual(await api.get('/catalog', readOptions), [item])
  assert.equal(catalogReads, 5)
  console.log('2. Preserved cache after a rejected write; invalidated it after a successful write.')

  const controller = new AbortController()
  const pending = api.get('/pending', { signal: controller.signal })
  const cancelled = assert.rejects(pending, error => {
    return isRequestError(error) && error.code === 'ABORT_ERROR'
  })
  await Promise.race([pendingStarted, pending])
  controller.abort()
  await cancelled
  console.log('3. Cancelled a pending request when leaving the view.')
} finally {
  // Logout clears session data as well as credentials. Discard this client
  // after outstanding requests have settled; create a new one for a new user.
  await cache.clear()
  await storage.remove()
  api.unuse('cache').unuse('retry').unuse('auth')
}

assert.equal(accessToken, undefined)
console.log('4. Cleared session state and removed plugins on logout.')

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
