import assert from 'node:assert/strict'
import {
  createClient,
  RequestError
} from '@npora/request/core'
import { retryPlugin } from '@npora/request/plugins/retry'
import { MockAdapter } from '@npora/request/testing'

const adapter = new MockAdapter()

adapter
  .onGet('/retry')
  .networkErrorOnce()
  .onGet('/retry')
  .reply(200, { format: 'esm-subpath' })

const request = createClient({ adapter }).use(
  retryPlugin({ retries: 1 })
)

assert.deepEqual(await request.get('/retry'), {
  format: 'esm-subpath'
})

adapter.onGet('/error').reply(503, { unavailable: true })

await assert.rejects(
  request.get('/error'),
  error => error instanceof RequestError && error.status === 503
)
