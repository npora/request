import assert from 'node:assert/strict'

/** Shared by offline tarball and actual registry-installed ESM/CJS consumers. */
export async function checkCapabilityContract({ createClient, TieredCacheStore, MemoryCacheStore, toFormErrors, concurrencyPlugin, MockAdapter, FetchAdapter }, format) {
  const recorder = new MockAdapter({ record: { adapter: new FetchAdapter() } })
  const recordingClient = createClient({ adapter: recorder,
    fetch: async () => new Response(JSON.stringify({ id: 1, accessToken: 'private' }), {
      headers: { 'content-type': 'application/json', 'set-cookie': 'secret=true' }
    })
  })
  assert.deepEqual(await recordingClient.get('/recorded'), { id: 1, accessToken: 'private' })
  assert.deepEqual(recorder.recordings[0].response.data, { id: 1, accessToken: '[REDACTED]' })
  assert.equal(recorder.recordings[0].response.headers['set-cookie'], undefined)
  const offline = new MockAdapter()
  new Function('mock', recorder.exportMocks())(offline)
  assert.deepEqual(await createClient({ adapter: offline }).get('/recorded'), { id: 1, accessToken: '[REDACTED]' })

  const releases = []
  let started
  const firstStarted = new Promise(resolve => { started = resolve })
  const fetch = () => new Promise(resolve => { releases.push(resolve); started() })
  const permits = concurrencyPlugin({ maxConcurrent: 1 })
  const firstClient = createClient({ fetch }).use(permits)
  const secondClient = createClient({ fetch }).use(permits)
  const first = firstClient.get('/first')
  await firstStarted
  const secondStarted = new Promise(resolve => { started = resolve })
  const second = secondClient.get('/second')
  releases[0](new Response('first'))
  assert.equal(await first, 'first')
  await secondStarted
  firstClient.unuse('concurrency')
  assert.deepEqual(permits.getState('default'), { active: 1, queued: 0 })
  releases[1](new Response('second'))
  assert.equal(await second, 'second')
  assert.deepEqual(permits.getState('default'), { active: 0, queued: 0 })
  secondClient.unuse('concurrency')

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
  console.log(`${format}: installed shared concurrency, SSE, form mapping and cache capability contracts passed.`)
}
