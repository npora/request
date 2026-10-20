import { expect, test } from '@playwright/test'

test('aborts prefetched streams without waiting for source cleanup', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { createClient } = await import('/dist/index.js')
    const results = []
    for (const responseType of ['stream', 'sse', 'ndjson'] as const) {
      const controller = new AbortController()
      let cancellations = 0
      const source = new ReadableStream<Uint8Array>({
        pull(stream) { stream.enqueue(new TextEncoder().encode('data: queued\n\n')) },
        cancel() { cancellations++; return new Promise<void>(() => {}) }
      }, { highWaterMark: 0 })
      const client = createClient({ fetch: async () => new Response(source) })
      const data = await client.get('/unused', {
        responseType, signal: controller.signal, timeout: 5000, totalTimeout: 10000
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      controller.abort()
      await new Promise(resolve => setTimeout(resolve, 0))
      let code = 'resolved'
      try {
        if (data instanceof ReadableStream) {
          const reader = data.getReader()
          try { await reader.read() } finally { reader.releaseLock() }
        } else {
          for await (const item of data as AsyncIterable<unknown>) void item
        }
      } catch (error) { code = (error as { code: string }).code }
      results.push({ responseType, cancellations, locked: source.locked, code })
    }
    return results
  })
  expect(results).toEqual(['stream', 'sse', 'ndjson'].map(responseType => ({
    responseType, cancellations: 1, locked: false, code: 'ABORT_ERROR'
  })))
})
