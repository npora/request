import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from './runtime.mjs'
import { FormData } from 'miniflare'

let runtime, directory
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'npora-website-'))
  runtime = await createRuntime({ resourcePersistencePath: directory, isolatedResourcePersistencePath: directory })
})
after(async () => { await runtime?.dispose(); if (directory) await rm(directory, { recursive: true, force: true }) })
const request = (path, options = {}) => runtime.dispatchFetch(`https://demo.test${path}`, {
  ...options, headers: { 'x-demo-session': 'api-contract', ...options.headers }
})

test('Pages serves the public site; unknown APIs and source paths never return the home page', async () => {
  const health = await runtime.dispatchFetch('https://demo.test/api/health')
  assert.equal(health.status, 200); assert.equal((await health.json()).ready, true)
  const page = await request('/')
  assert.equal(page.status, 200); assert.match(await page.text(), /See your requests in action/)
  for (const path of ['/api', '/api/missing', '/functions/api/user.js', '/wrangler.jsonc', '/state/worker.mjs']) {
    const response = await request(path)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(await response.text(), /See your requests in action/)
  }
})

test('GET returns user data and Schema endpoint deliberately violates its types', async () => {
  const user = await (await request('/api/user')).json()
  assert.equal(user.id, 1); assert.equal(user.profile.team, 'Npora')
  const invalid = await (await request('/api/schema')).json()
  assert.equal(invalid.id, 'abc'); assert.equal(invalid.email, null)
})

test('QUERY requires its method and parses nested JSON; malformed/oversized bodies are bounded', async () => {
  const get = await request('/api/query'); assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'QUERY')
  const body = { filter: { roles: ['developer'], active: true }, page: { limit: 10 } }
  const query = await request('/api/query', { method: 'QUERY', body: JSON.stringify(body) })
  assert.equal(query.status, 200); assert.deepEqual((await query.json()).filters, body)
  assert.equal((await request('/api/query', { method: 'QUERY', body: '{' })).status, 400)
  assert.equal((await request('/api/query', { method: 'QUERY', body: '[]' })).status, 400)
  assert.equal((await request('/api/query', { method: 'QUERY', body: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 413)
  const bytes = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1024 * 1024 + 1)); controller.close()
  } })
  assert.equal((await request('/api/upload', { method: 'POST', body: bytes, duplex: 'half' })).status, 413)
})

test('SSE arrives incrementally, emits three events and terminates cleanly', async () => {
  const start = Date.now()
  const response = await request('/api/sse')
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const reader = response.body.getReader()
  const first = await reader.read()
  const firstAt = Date.now() - start
  assert.match(new TextDecoder().decode(first.value), /id: 1/)
  assert.ok(firstAt >= 800, `first arrived after ${firstAt}ms`)
  let text = new TextDecoder().decode(first.value)
  while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value) }
  assert.equal((text.match(/data:/g) ?? []).length, 3)
  assert.ok(Date.now() - start >= firstAt + 1500, 'First event must arrive before stream completion')
})

test('NDJSON frames are independent and a slow consumer does not lose records', async () => {
  const response = await request('/api/ndjson')
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/)
  const reader = response.body.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  assert.equal(JSON.parse(first).id, 1)
  await new Promise(resolve => setTimeout(resolve, 350))
  let text = first
  while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value) }
  assert.deepEqual(text.trim().split('\n').map(line => JSON.parse(line).id), [1, 2, 3, 4, 5, 6])
})

test('retry attempts persist across runtime restart and isolate separate demo sessions', async () => {
  const first = await request('/api/retry?run=persisted')
  assert.equal(first.status, 503); assert.equal((await first.json()).attempt, 1)
  await runtime.dispose()
  runtime = await createRuntime({ resourcePersistencePath: directory, isolatedResourcePersistencePath: directory })
  const second = await request('/api/retry?run=persisted')
  assert.equal(second.status, 503); assert.equal((await second.json()).attempt, 2)
  const third = await request('/api/retry?run=persisted')
  assert.equal(third.status, 200); assert.equal((await third.json()).attempt, 3)
  const isolated = await request('/api/retry?run=persisted', { headers: { 'x-demo-session': 'another-session' } })
  assert.equal((await isolated.json()).attempt, 1)
  assert.equal((await request('/api/retry?run=%3Cscript%3E')).status, 400)
})

test('simultaneous retry attempts serialize without lost counter updates', async () => {
  const responses = await Promise.all(Array.from({ length: 3 }, () => request('/api/retry?run=parallel')))
  const values = await Promise.all(responses.map(value => value.json()))
  assert.deepEqual(values.map(value => value.attempt).sort(), [1, 2, 3])
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 503, 503])
})

test('slow endpoint really waits ten seconds; cancellation is possible', async () => {
  const start = Date.now()
  const response = await request('/api/timeout')
  assert.deepEqual(await response.json(), { waited: 10000 })
  assert.ok(Date.now() - start >= 9500)
})

test('upload verifies multipart file bytes; download is a paced one-MiB stream', async () => {
  const data = new FormData()
  data.append('file', new Blob([new Uint8Array(1048576)]), 'sample.bin')
  const uploaded = await request('/api/upload', { method: 'POST', body: data })
  assert.equal(uploaded.status, 200)
  const result = await uploaded.json()
  assert.equal(result.bytes, 1048576); assert.ok(result.receivedBytes > result.bytes)
  const malformed = await request('/api/upload', { method: 'POST', body: 'not multipart' })
  assert.equal(malformed.status, 400)
  const start = Date.now()
  const download = await request('/api/download')
  assert.equal(download.headers.get('content-length'), '1048576')
  assert.equal((await download.arrayBuffer()).byteLength, 1048576)
  assert.ok(Date.now() - start >= 1200)
})

test('expired bearer is rejected, refresh creates a session-bound credential', async () => {
  assert.equal((await request('/api/auth', { headers: { authorization: 'Bearer expired' } })).status, 401)
  const refreshed = await request('/api/refresh', { method: 'POST' })
  assert.equal(refreshed.status, 200)
  const { accessToken } = await refreshed.json()
  assert.equal((await request('/api/auth', { headers: { authorization: `Bearer ${accessToken}` } })).status, 200)
  assert.equal((await request('/api/auth', { headers: { authorization: `Bearer ${accessToken}`, 'x-demo-session': 'other-auth' } })).status, 401)
  assert.equal((await request('/api/refresh')).status, 405)
})

test('traffic admission is IP scoped, serializes bursts and honors its five-second cooldown', async () => {
  const headers = { 'cf-connecting-ip': '192.0.2.1' }
  const responses = await Promise.all(Array.from({ length: 7 }, (_, index) => request('/api/traffic', {
    headers: { ...headers, 'x-demo-session': `visitor-${index}` }
  })))
  assert.equal(responses.filter(value => value.status === 200).length, 5)
  for (const response of responses.filter(value => value.status === 429)) assert.equal(response.headers.get('retry-after'), '5')
  assert.equal((await request('/api/traffic', { headers: { 'cf-connecting-ip': '192.0.2.2' } })).status, 200)
  await new Promise(resolve => setTimeout(resolve, 5100))
  assert.equal((await request('/api/traffic', { headers })).status, 200)
})

test('stream readers can cancel without leaving unresolved pulls', async () => {
  for (const path of ['/api/sse', '/api/ndjson', '/api/download']) {
    const response = await request(path)
    const reader = response.body.getReader()
    await reader.read(); await reader.cancel('done')
    assert.equal((await reader.read()).done, true)
  }
})

test('the explicitly labelled recovery probe emits 429 then recovers independently of IP traffic', async () => {
  const first = await request('/api/traffic-probe')
  assert.equal(first.status, 429); assert.equal(first.headers.get('retry-after'), '5')
  assert.equal((await first.json()).probe, true)
  await new Promise(resolve => setTimeout(resolve, 5100))
  const recovered = await request('/api/traffic-probe')
  assert.equal(recovered.status, 200)
  assert.deepEqual(await recovered.json(), { accepted: true, probe: true })
})
