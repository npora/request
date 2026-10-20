import assert from 'node:assert/strict'
import { createClient, isRequestError } from '../src/core-entry'
import { concurrencyPlugin } from '../src/plugins/concurrencyPlugin'
import { retryPlugin } from '../src/plugins/retryPlugin'

function gate() {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  return { pending, release }
}
const keys = ['a:1', 'b:1', 'retry:1', 'retry:2', 'missing:1']
const permits = new Map(keys.map(key => [key, gate()]))
const starts = new Map(keys.map(key => [key, gate()]))
const attempts = new Map<string, number>()
let activeTransports = 0
let peakTransports = 0
const origin = 'https://example.test'

// Gates replace network delays so the example can assert queue behavior without
// sleeping. The fixture still observes the transport's cancellation signal.
const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
  const id = new URL(String(input)).pathname.split('/').pop()!
  const attempt = (attempts.get(id) ?? 0) + 1
  attempts.set(id, attempt)
  const key = `${id}:${attempt}`
  const permit = permits.get(key)
  assert.ok(permit, `Unexpected transport: ${key}`)
  activeTransports++
  peakTransports = Math.max(peakTransports, activeTransports)
  starts.get(key)!.release()
  const signal = init?.signal
  let onAbort: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => reject(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      void permit.pending.then(resolve)
    })
    if (id === 'retry' && attempt === 1) return Response.json({ message: 'Try again' }, { status: 503 })
    if (id === 'missing') return Response.json({ message: 'Missing item' }, { status: 404 })
    return Response.json({ id })
  } finally {
    signal?.removeEventListener('abort', onAbort!)
    activeTransports--
  }
}

const concurrency = concurrencyPlugin({ maxConcurrent: 2, maxQueue: 3, queueTimeout: 1000 })
const api = createClient({
  baseURL: origin, fetch: fixtureFetch, timeout: 1000, totalTimeout: 5000
}).use(concurrency).use(retryPlugin({ retries: 1, delay: 0 }))
const cancelled = new AbortController()
const ids = ['a', 'b', 'cancelled', 'retry', 'missing', 'overflow']
const requests = ids.map(id => api.get<{ id: string }>(`/items/${id}`, {
  signal: id === 'cancelled' ? cancelled.signal : undefined
}))
// Observe every rejection immediately, and retain one result for each input.
const finished = Promise.allSettled(requests)
async function started(key: string) {
  await Promise.race([
    starts.get(key)!.pending,
    finished.then(() => { throw new Error(`Batch ended before ${key} started`) })
  ])
}

try {
  await Promise.all([started('a:1'), started('b:1')])
  assert.deepEqual(concurrency.getState(origin), { active: 2, queued: 3 })
  await assert.rejects(requests[5]!, error => isRequestError(error) && error.code === 'CONCURRENCY_LIMIT')
  cancelled.abort()
  await assert.rejects(requests[2]!, error => isRequestError(error) && error.code === 'ABORT_ERROR')
  assert.deepEqual(concurrency.getState(origin), { active: 2, queued: 2 })

  permits.get('a:1')!.release()
  await started('retry:1')
  permits.get('retry:1')!.release()
  await started('retry:2')
  // Retrying owns its original logical permit; the next item still waits.
  assert.deepEqual(concurrency.getState(origin), { active: 2, queued: 1 })
  assert.equal(attempts.has('missing'), false)
  permits.get('retry:2')!.release()
  await started('missing:1')
  permits.get('missing:1')!.release()
  permits.get('b:1')!.release()

  const outcomes = (await finished).map((result, index) => {
    if (result.status === 'fulfilled') return { id: ids[index], value: result.value }
    assert.ok(isRequestError(result.reason))
    return { id: ids[index], code: result.reason.code, status: result.reason.status }
  })
  assert.deepEqual(outcomes, [
    { id: 'a', value: { id: 'a' } },
    { id: 'b', value: { id: 'b' } },
    { id: 'cancelled', code: 'ABORT_ERROR', status: undefined },
    { id: 'retry', value: { id: 'retry' } },
    { id: 'missing', code: 'HTTP_ERROR', status: 404 },
    { id: 'overflow', code: 'CONCURRENCY_LIMIT', status: undefined }
  ])
  assert.equal(attempts.get('retry'), 2)
  assert.equal(attempts.has('cancelled'), false)
  assert.equal(attempts.has('overflow'), false)
  assert.equal(peakTransports, 2)
  assert.deepEqual(concurrency.getState(origin), { active: 0, queued: 0 })
  console.log('Batch passed: bounded concurrency, queue cancellation, retry permits, partial failure, and input-order results.')
} finally {
  for (const permit of permits.values()) permit.release()
  await finished
  api.unuse('concurrency').unuse('retry')
}
