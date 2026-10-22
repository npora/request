import { createClient } from '../dist/core.js'
import { MemoryCacheStore, TieredCacheStore } from '../dist/plugins/cache.js'
import { toFormErrors } from '../dist/schema-errors.js'

function assert(value, message) {
  if (!value) throw new Error(message)
}

/** Executed inside workerd and real browser Service Workers, without Node shims. */
export async function runRuntimeContract(baseURL, fetchImplementation = fetch) {
  const client = createClient({ baseURL, fetch: fetchImplementation })
  const data = await client.get('/api/user', {
    schema: {
      '~standard': {
        version: 1, vendor: 'runtime-contract',
        validate(value) {
          return value?.id === 1 ? { value: value.name } : { issues: [{ message: 'Invalid user' }] }
        }
      }
    }
  })
  assert(data === 'Npora', 'JSON/schema transformation')

  const form = new FormData()
  form.set('name', 'runtime')
  const uploaded = await client.post('/api/upload', { body: form })
  assert(uploaded.received > 0 && uploaded.contentType.includes('multipart/form-data'), 'FormData upload')

  for (const timeout of [false, true]) {
    const controller = new AbortController()
    const timer = timeout ? undefined : setTimeout(() => controller.abort(), 5)
    try {
      await client.get('/api/slow', timeout ? { timeout: 5 } : { signal: controller.signal })
      throw new Error('Request unexpectedly completed')
    } catch (error) {
      assert(error.code === (timeout ? 'TIMEOUT_ERROR' : 'ABORT_ERROR'), 'Timeout/abort classification')
    } finally {
      clearTimeout(timer)
    }
  }

  const states = []
  const events = []
  for await (const event of await client.sse('/api/events', { onStateChange: state => states.push(state) })) {
    events.push(event.data)
  }
  assert(events.length === 2, 'SSE parsing')
  assert(states.join() === 'connecting,open,closed', 'SSE states')
  const records = []
  for await (const record of await client.ndjson('/api/records')) records.push(record)
  assert(records.length === 2 && records[0].name === '你好', 'NDJSON/UTF-8 parsing')

  const store = new TieredCacheStore({ primary: new MemoryCacheStore(), secondary: new MemoryCacheStore() })
  assert(store.acquireRefreshLease === undefined, 'Optional coordination')
  store.set('key', { data: 'cached', expiresAt: Infinity, status: 200, statusText: 'OK', headers: [] })
  assert(store.get('key')?.data === 'cached', 'Tiered memory cache')
  store.dispose()
  const errors = toFormErrors([{ path: ['users', 0, 'name'], message: 'Required' }])
  assert(errors.fieldErrors['users.0.name'][0] === 'Required', 'Optional schema helper')
  return {
    json: true, schema: true, formData: true, abort: true, timeout: true,
    sse: true, ndjson: true, tieredCache: true, formErrors: true,
    webLocksAvailable: typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
  }
}
