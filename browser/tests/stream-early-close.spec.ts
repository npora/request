import { expect, test } from '@playwright/test'

for (const format of ['ndjson', 'sse', 'reconnecting sse']) {
  for (const method of ['return', 'throw']) {
    test(`closes unopened ${format} with ${method}`, async ({ page }) => {
      await page.goto('/')
      const result = await page.evaluate(async ({ format, method }) => {
        const { createClient } = await import('/dist/index.js')
        let cancellations = 0
        let requests = 0
        let validations = 0
        const controller = new AbortController()
        const body = new ReadableStream<Uint8Array>({ cancel() { cancellations += 1 } })
        const client = createClient({
          fetch: async () => { requests += 1; return new Response(body) }
        })
        const config = {
          signal: controller.signal,
          timeout: 5000,
          totalTimeout: 10000,
          itemSchema: {
            '~standard': {
              version: 1 as const,
              vendor: 'browser-test',
              validate(value: unknown) { validations += 1; return { value } }
            }
          }
        }
        const data = format === 'ndjson'
          ? await client.ndjson('/unused', config)
          : await client.sse('/unused', {
              ...config,
              ...(format === 'reconnecting sse' ? { reconnect: { maxAttempts: 3 } } : {})
            })
        const iterator = data[Symbol.asyncIterator]()
        const reason = new Error('consumer stopped')
        let originalError = false
        if (method === 'throw') {
          try { await iterator.throw!(reason) } catch (error) { originalError = error === reason }
        } else {
          await iterator.return!()
        }
        const next = await iterator.next()
        await iterator.return!()
        controller.abort()
        await new Promise(resolve => setTimeout(resolve, 0))
        return { cancellations, requests, validations, locked: body.locked, done: next.done, originalError }
      }, { format, method })
      expect(result).toEqual({
        cancellations: 1, requests: 1, validations: 0, locked: false,
        done: true, originalError: method === 'throw'
      })
    })
  }
}
