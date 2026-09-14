import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createClient } from '@npora/request/core'
import { cachePlugin } from '@npora/request/plugins/cache'
import { retryPlugin } from '@npora/request/plugins/retry'

let count = 0
let retries = 0
const server = createServer((request, response) => {
  if (request.url === '/count') {
    count += 1
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'max-age=60'
    })
    response.end(JSON.stringify({ count }))
    return
  }

  if (request.url === '/retry') {
    retries += 1
    response.writeHead(retries === 1 ? 503 : 200, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    response.end(JSON.stringify({ retries }))
    return
  }

  if (request.url === '/slow') {
    setTimeout(() => {
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      }
    }, 200)
    return
  }

  response.writeHead(422, { 'content-type': 'application/json' })
  response.end('{"message":"invalid"}')
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')

try {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const cache = cachePlugin()
  const api = createClient({
    baseURL: `http://127.0.0.1:${address.port}`,
    extensions: { cache: { enabled: true } }
  }).use(cache).use(retryPlugin({ retries: 1, delay: 0 }))

  assert.deepEqual(await api.get('/count'), { count: 1 })
  assert.deepEqual(await api.get('/count'), { count: 1 })
  assert.equal(count, 1)
  await cache.clear()
  assert.deepEqual(await api.get('/count'), { count: 2 })

  assert.deepEqual(await api.get('/retry'), { retries: 2 })
  await assert.rejects(api.get('/error'), error => error.code === 'HTTP_ERROR')

  const controller = new AbortController()
  const pending = api.get('/slow', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, error => error.code === 'ABORT_ERROR')

  console.log('Installed Node consumer passed.')
} finally {
  server.closeAllConnections()
  server.close()
  await once(server, 'close')
}
