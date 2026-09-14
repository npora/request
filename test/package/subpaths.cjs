const assert = require('node:assert/strict')
const {
  createClient,
  RequestError
} = require('@npora/request/core')
const {
  retryPlugin
} = require('@npora/request/plugins/retry')
const { MockAdapter } = require('@npora/request/adapters/mock')
const { memoryCachePlugin } = require('@npora/request/plugins/memory-cache')

async function main() {
  const adapter = new MockAdapter()

  adapter
    .onGet('/retry')
    .networkErrorOnce()
    .onGet('/retry')
    .reply(200, { format: 'cjs-subpath' })

  const request = createClient({ adapter }).use(
    retryPlugin({ retries: 1 })
  )

  assert.deepEqual(await request.get('/retry'), {
    format: 'cjs-subpath'
  })

  adapter.onGet('/memory').reply(200, { format: 'memory-subpath' })
  const memory = createClient({
    adapter,
    fetchOptions: { credentials: 'omit' },
    extensions: { memoryCache: { enabled: true } }
  }).use(memoryCachePlugin())
  assert.deepEqual(await memory.get('/memory'), { format: 'memory-subpath' })
  assert.deepEqual(await memory.get('/memory'), { format: 'memory-subpath' })

  adapter.onGet('/error').reply(503, { unavailable: true })

  await assert.rejects(
    request.get('/error'),
    error => error instanceof RequestError && error.status === 503
  )
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
