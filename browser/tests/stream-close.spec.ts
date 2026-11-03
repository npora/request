import { expect, test } from '@playwright/test'

test('closing a pending SSE or NDJSON iterator releases reads and validators', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { createClient } = await import('/dist/core.js')
    const results = []
    for (const format of ['ndjson', 'sse', 'observed', 'reconnecting']) {
      for (const stage of ['read', 'schema']) {
        for (const method of ['return', 'throw']) {
          let entered!: () => void
          const waiting = new Promise<void>(resolve => { entered = resolve })
          let cancelled = 0
          const body = new ReadableStream({
            start(controller) {
              if (stage === 'schema') controller.enqueue(new TextEncoder().encode(format === 'ndjson' ? '{}\n' : 'data: hello\n\n'))
            },
            pull() { if (stage === 'read') entered() },
            cancel() { cancelled++ }
          })
          const controller = new AbortController()
          const api = createClient({ fetch: async () => new Response(body) })
          const config = {
            signal: controller.signal, timeout: 1000, totalTimeout: 2000,
            ...(stage === 'schema' ? { itemSchema: { '~standard': {
              version: 1, vendor: 'browser', validate() {
                entered()
                return new Promise(() => {})
              }
            } } } : {})
          }
          const stream = format === 'ndjson' ? await api.ndjson('/stream', config)
            : await api.sse('/stream', { ...config,
                ...(format === 'observed' ? { onStateChange() {} } : {}),
                ...(format === 'reconnecting' ? { reconnect: { maxAttempts: 2 } } : {}) })
          const iterator = stream[Symbol.asyncIterator]()
          const reading = iterator.next().then(value => value.done, () => false)
          await waiting
          const reason = new Error('consumer stopped')
          const closing = (method === 'return' ? iterator.return('finished') : iterator.throw(reason))
            .then(value => value.done && value.value === 'finished', error => error === reason)
          const closed = await closing
          results.push({ format, stage, method, closed, readDone: await reading, cancelled,
            locked: body.locked, callerAborted: controller.signal.aborted })
        }
      }
    }
    return results
  })
  expect(results).toHaveLength(16)
  for (const result of results) {
    expect(result, `${result.format}/${result.stage}/${result.method}`).toMatchObject({
      closed: true, readDone: true, cancelled: 1, locked: false, callerAborted: false
    })
  }
})
