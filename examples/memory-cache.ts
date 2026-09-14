import { createServer } from 'node:http'
import { once } from 'node:events'
import { createClient } from '../src/core-entry'
import { memoryCachePlugin } from '../src/plugins/memoryCachePlugin'

let networkRequests = 0
const server = createServer((_request, response) => {
  networkRequests++
  response.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'max-age=60'
  })
  response.end(JSON.stringify({ networkRequests }))
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')

try {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')

  const cache = memoryCachePlugin({ ttl: 5000, maxEntries: 50 })
  const api = createClient({
    baseURL: `http://127.0.0.1:${address.port}`,
    fetchOptions: { credentials: 'omit' },
    extensions: { memoryCache: { enabled: true } }
  }).use(cache)

  console.log(await api.get('/catalog')) // { networkRequests: 1 }
  console.log(await api.get('/catalog')) // { networkRequests: 1 }
  cache.clear()
  console.log(await api.get('/catalog')) // { networkRequests: 2 }
} finally {
  server.closeAllConnections()
  server.close()
  await once(server, 'close')
}
