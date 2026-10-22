import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { Agent, fetch as undiciFetch } from 'undici'
import { createClient } from '../../dist/core.js'

test('injected Undici dispatcher reuses a connection and cleans up aborts and streams', { timeout: 15000 }, async () => {
  let connections = 0
  const server = createServer((request, response) => {
    if (request.url === '/slow') return
    if (request.url === '/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: first\n\n')
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end('{"ok":true}')
  })
  server.on('connection', () => connections++)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const dispatcher = new Agent({ connections: 1, pipelining: 1 })
  const client = createClient({
    baseURL: `http://127.0.0.1:${server.address().port}`,
    fetch: (input, init) => undiciFetch(input, { ...init, dispatcher })
  })
  try {
    for (let index = 0; index < 3; index++) assert.deepEqual(await client.get('/json'), { ok: true })
    assert.equal(connections, 1, 'Sequential requests should reuse one pooled connection')
    await assert.rejects(client.get('/slow', { timeout: 20 }), { code: 'TIMEOUT_ERROR' })
    assert.deepEqual(await client.get('/json'), { ok: true })

    const controller = new AbortController()
    const pending = client.get('/slow', { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { code: 'ABORT_ERROR' })

    const stream = await client.sse('/stream')
    const iterator = stream[Symbol.asyncIterator]()
    assert.equal((await iterator.next()).value.data, 'first')
    await iterator.return()
    assert.deepEqual(await client.get('/json'), { ok: true }, 'Released stream must not starve a one-connection pool')
  } finally {
    await dispatcher.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
