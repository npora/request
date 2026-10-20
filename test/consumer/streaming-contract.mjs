import assert from 'node:assert/strict'

/** Black-box contracts shared by installed ESM and CommonJS consumers. */
export async function checkStreamingContract({ createClient, isRequestError }, format) {
  const bytes = text => new TextEncoder().encode(text)
  const schema = {
    '~standard': {
      version: 1, vendor: 'installed-consumer',
      validate(value) {
        return typeof value === 'object' && value !== null && typeof value.id === 'number'
          ? { value: { id: value.id } }
          : { issues: [{ message: 'Expected numeric id' }] }
      }
    }
  }
  const collect = async iterable => {
    const values = []
    for await (const value of iterable) values.push(value)
    return values
  }
  let emitted = false
  const api = createClient({ fetch: async () => new Response(new ReadableStream({
    pull(controller) {
      if (emitted) controller.close()
      else { emitted = true; controller.enqueue(bytes('{"id":1}\n{"id":2}\n')) }
    }
  }), { headers: { 'content-type': 'application/x-ndjson' } }) })
  assert.deepEqual(await collect(await api.ndjson('https://example.test/records', { itemSchema: schema })),
    [{ id: 1 }, { id: 2 }])

  const events = createClient({ fetch: async () => new Response('id: first\ndata: hello\n\n', {
    headers: { 'content-type': 'text/event-stream' }
  }) })
  assert.deepEqual(await collect(await events.sse('https://example.test/events')),
    [{ id: 'first', event: 'message', data: 'hello' }])

  const bad = createClient({ fetch: async () => new Response('{"id":"wrong"}\n', {
    headers: { 'content-type': 'application/x-ndjson' }
  }) })
  await assert.rejects(collect(await bad.ndjson('https://example.test/invalid', { itemSchema: schema })),
    error => isRequestError(error) && error.code === 'SCHEMA_ERROR' && error.status === 200)

  let cancelCalls = 0
  const oversized = createClient({ fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(16)) },
    cancel() { cancelCalls++ }
  }, { highWaterMark: 0 })) })
  const response = await oversized.getResponse('https://example.test/large', {
    responseType: 'stream', maxResponseSize: 8, timeout: 1000
  })
  const reader = response.data.getReader()
  try {
    await assert.rejects(reader.read(), error => isRequestError(error) && error.code === 'RESPONSE_TOO_LARGE')
  } finally { reader.releaseLock() }
  assert.equal(cancelCalls, 1)

  let earlyCancelled = false
  const early = createClient({ fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(bytes('{"id":1}\n')) },
    cancel() { earlyCancelled = true }
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/x-ndjson' } }) })
  for await (const value of await early.ndjson('https://example.test/early', {
    maxResponseSize: 1000, timeout: 1000
  })) {
    assert.deepEqual(value, { id: 1 })
    break
  }
  assert.equal(earlyCancelled, true)

  let aborted = false
  const controller = new AbortController()
  const idle = createClient({ fetch: async () => new Response(new ReadableStream({
    cancel() { aborted = true }
  }, { highWaterMark: 0 })) })
  const stream = await idle.get('https://example.test/idle', {
    responseType: 'stream', signal: controller.signal, maxResponseSize: 8, timeout: 1000
  })
  const idleReader = stream.getReader()
  try {
    const rejected = assert.rejects(idleReader.read(),
      error => isRequestError(error) && error.code === 'ABORT_ERROR')
    controller.abort()
    await rejected
  } finally { idleReader.releaseLock() }
  assert.equal(aborted, true)

  const inherited = new AbortController()
  let connections = 0
  const reconnecting = createClient({
    signal: inherited.signal,
    totalTimeout: 5000,
    fetch: async () => {
      connections++
      return new Response('data: first\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    }
  }).extend()
  const iterator = (await reconnecting.sse('https://example.test/reconnect', {
    reconnect: { maxAttempts: 1, delay: 1000 }
  }))[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value.data, 'first')
  const next = iterator.next()
  let outcome = 'pending'
  void next.then(() => { outcome = 'resolved' }, error => { outcome = error.code })
  await new Promise(resolve => setImmediate(resolve))
  inherited.abort()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(outcome, 'ABORT_ERROR', 'inherited cancellation must interrupt the reconnect delay')
  assert.equal(connections, 1)
  console.log(`Installed ${format} streaming contracts passed.`)
}
