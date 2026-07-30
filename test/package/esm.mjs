import assert from 'node:assert/strict'
import {
  createClient,
  MockAdapter
} from '@npora/request'

const adapter = new MockAdapter()

adapter.on('/smoke', config => {
  return {
    format: 'esm',
    method: config.method
  }
})

const request = createClient({
  adapter
})
const data = await request.get('/smoke')

assert.deepEqual(data, {
  format: 'esm',
  method: 'GET'
})
