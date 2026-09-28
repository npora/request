import assert from 'node:assert/strict'
import {
  authPlugin,
  createClient,
  isRequestError,
  type AuthTokenStorage
} from '../src'

// Native Response fixtures make this demo runnable without a remote API.
// Replace fetch with the platform implementation when connecting a real API.
let token: string | undefined = 'expired-token'
let refreshCalls = 0
let tokenWrites = 0
let tokenRemovals = 0
let denyRefresh = false
let rejectedRequests = 0
let unblockRefresh!: () => void
let notifyWaiters!: () => void
const refreshGate = new Promise<void>(resolve => { unblockRefresh = resolve })
const waitersReady = new Promise<void>(resolve => { notifyWaiters = resolve })

const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.pathname === '/refresh') {
    refreshCalls += 1
    await refreshGate
    return denyRefresh
      ? jsonResponse({ message: 'Refresh session expired' }, 401)
      : jsonResponse({ accessToken: 'fresh-token' })
  }

  if (url.pathname === '/account') {
    const headers = new Headers(init?.headers)
    return headers.get('authorization') === 'Bearer fresh-token'
      ? jsonResponse({ name: 'Ada' })
      : jsonResponse({ message: 'Access token expired' }, 401)
  }

  return jsonResponse({ message: 'Not found' }, 404)
}

const storage: AuthTokenStorage = {
  get: () => token,
  set(value) {
    token = value
    tokenWrites += 1
  },
  remove() {
    token = undefined
    tokenRemovals += 1
  }
}

// The refresh client has its own deadline and does not install authPlugin.
// A cancelled account request must not cancel the shared refresh request.
const sessionApi = createClient({
  baseURL: 'https://example.test',
  fetch: fixtureFetch,
  totalTimeout: 3000
})
const api = sessionApi.extend().use(authPlugin({
  storage,
  shouldRefresh(error) {
    const eligible = isRequestError(error) && error.status === 401
    if (eligible && ++rejectedRequests === 3) notifyWaiters()
    return eligible
  },
  async refreshToken() {
    try {
      const session = await sessionApi.post<{ accessToken: string }>('/refresh')
      return session.accessToken
    } catch (error) {
      // Logout policy belongs to the application. Clear credentials only
      // when the refresh endpoint rejects the session, not on network errors.
      if (isRequestError(error) && error.status === 401) await storage.remove()
      throw error
    }
  }
}))

console.log('\n1. Share a refresh while one caller cancels')
const controller = new AbortController()
const batch = Promise.allSettled([
  api.get<{ name: string }>('/account'),
  api.get<{ name: string }>('/account'),
  api.get('/account', { signal: controller.signal })
])
try {
  await Promise.race([
    waitersReady,
    batch.then(() => { throw new Error('Requests settled before sharing refresh') })
  ])
  controller.abort()
} finally {
  unblockRefresh()
}
const results = await batch
for (const result of results.slice(0, 2)) {
  assert.equal(result.status, 'fulfilled')
  if (result.status === 'fulfilled') assert.deepEqual(result.value, { name: 'Ada' })
}
const cancelled = results[2]!
assert.equal(cancelled.status, 'rejected')
if (cancelled.status === 'rejected') {
  assert.ok(isRequestError(cancelled.reason))
  assert.equal(cancelled.reason.code, 'ABORT_ERROR')
}
assert.equal(refreshCalls, 1)
assert.equal(tokenWrites, 1)
console.log('Two callers succeeded; one cancelled; one refresh and one token write.')

console.log('\n2. Reuse the stored token on a later request')
assert.deepEqual(await api.get('/account'), { name: 'Ada' })
assert.equal(refreshCalls, 1)
console.log('The later request needed no refresh.')

console.log('\n3. Handle an expired refresh session')
token = 'expired-token'
denyRefresh = true
await assert.rejects(api.get('/account'), error => {
  assert.ok(isRequestError<{ message: string }>(error))
  assert.equal(error.status, 401)
  assert.equal(error.data?.message, 'Access token expired')
  return true
})
assert.equal(refreshCalls, 2)
assert.equal(tokenRemovals, 1)
assert.equal(token, undefined)
console.log('Application cleared credentials; the original account error was preserved.')

console.log('\n4. Allow a later refresh after the failed operation')
token = 'expired-token'
denyRefresh = false
assert.deepEqual(await api.get('/account'), { name: 'Ada' })
assert.equal(refreshCalls, 3)
assert.equal(tokenWrites, 2)
console.log('Authentication refresh example completed.')

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
