import assert from 'node:assert/strict'

/** Shared by offline tarball and actual registry-installed ESM/CJS consumers. */
export async function checkCapabilityContract({ createClient, TieredCacheStore, MemoryCacheStore, toFormErrors }, format) {
  const errors = toFormErrors([
    { path: ['users', 0, 'name'], message: 'Required' },
    { path: ['users', 0, 'name'], message: 'Too short' },
    { path: ['__proto__'], message: 'Safe key' },
    { message: 'Form error' }
  ])
  assert.deepEqual(errors.fieldErrors['users.0.name'], ['Required', 'Too short'])
  assert.deepEqual(errors.fieldErrors.__proto__, ['Safe key'])
  assert.equal(Object.getPrototypeOf(errors.fieldErrors), null)
  assert.deepEqual(errors.formErrors, ['Form error'])

  const states = []
  let connections = 0
  const api = createClient({ fetch: async () => ++connections === 1
    ? new Response('data: installed\n\n', { headers: { 'content-type': 'text/event-stream' } })
    : new Response(null, { status: 204 })
  })
  const stream = await api.sse('/events', {
    reconnect: { maxAttempts: 1, delay: 0 }, onStateChange: state => states.push(state)
  })
  const events = []
  for await (const event of stream) events.push(event.data)
  assert.deepEqual(events, ['installed'])
  assert.deepEqual(states, ['connecting', 'open', 'reconnecting', 'closed'])
  assert.equal(connections, 2)

  let cancelled = false
  const earlyStates = []
  const early = await createClient({ fetch: async () => new Response(new ReadableStream({
    cancel() { cancelled = true }
  }), { headers: { 'content-type': 'text/event-stream' } }) }).sse('/early', {
    onStateChange: state => earlyStates.push(state)
  })
  await early[Symbol.asyncIterator]().return()
  assert.equal(cancelled, true)
  assert.deepEqual(earlyStates, ['connecting', 'open', 'closed'])

  const options = () => ({ primary: new MemoryCacheStore(), secondary: new MemoryCacheStore() })
  assert.throws(() => new TieredCacheStore({ ...options(), coordination: { locks: {} } }), { code: 'CONFIG_ERROR' })
  assert.throws(() => new TieredCacheStore({ ...options(), broadcast: { channel: {} } }), { code: 'CONFIG_ERROR' })
  const store = new TieredCacheStore(options())
  assert.equal(store.acquireRefreshLease, undefined)
  store.set('installed', { data: 'cached', expiresAt: Infinity, status: 200, statusText: 'OK', headers: [] })
  assert.equal(store.get('installed').data, 'cached')
  store.dispose()
  console.log(`${format}: installed SSE, form mapping and cache capability contracts passed.`)
}
