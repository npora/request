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

test('enforces decoded-record cancellation and streaming guards', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { createClient } = await import('/dist/index.js')
    const results: string[] = []
    for (const responseType of ['sse', 'ndjson'] as const) {
      const abort = new AbortController()
      const text = responseType === 'sse' ? 'data: 1\n\ndata: 2\n\n' : '1\n2\n'
      const iterable = await createClient({ fetch: async () => new Response(text) })
        .get<AsyncIterable<unknown>>('/unused', { responseType, signal: abort.signal })
      const iterator = iterable[Symbol.asyncIterator]()
      await iterator.next()
      abort.abort()
      try { await iterator.next(); results.push('unexpected-record') }
      catch (error) { results.push((error as { code: string }).code) }
    }
    const options = [
      { responseType: 'ndjson' as const, maxStreamLineSize: 7 },
      { responseType: 'sse' as const, maxSseEventSize: 8 }
    ]
    for (const config of options) {
      const text = config.responseType === 'sse' ? 'data: 你\n\n' : '"你好"\n'
      const iterable = await createClient({ fetch: async () => new Response(text) })
        .get<AsyncIterable<unknown>>('/unused', config)
      try { for await (const item of iterable) void item; results.push('unexpected-size') }
      catch (error) { results.push((error as { code: string }).code) }
    }
    for (const responseType of ['stream', 'sse', 'ndjson'] as const) {
      const data = await createClient({ fetch: async () => new Response(new ReadableStream()) })
        .get<ReadableStream | AsyncIterable<unknown>>('/unused', { responseType, streamIdleTimeout: 10 })
      try {
        if (data instanceof ReadableStream) {
          const reader = data.getReader()
          try { await reader.read() } finally { reader.releaseLock() }
        } else { for await (const item of data) void item }
        results.push('unexpected-timeout')
      } catch (error) { results.push((error as { code: string }).code) }
    }
    for (const responseType of ['sse', 'ndjson'] as const) {
      const data = await createClient({ fetch: async () => new Response(new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(responseType === 'sse' ? 'data: 1\n\n' : '1\n')) }
      })) }).get<AsyncIterable<unknown>>('/unused', {
        responseType, streamIdleTimeout: 10,
        itemSchema: { '~standard': {
          version: 1, vendor: 'browser-pending', validate: () => new Promise(() => {})
        } }
      })
      try { for await (const item of data) void item; results.push('unexpected-validation') }
      catch (error) { results.push((error as { code: string }).code) }
    }
    return results
  })
  expect(results).toEqual([
    'ABORT_ERROR', 'ABORT_ERROR', 'RESPONSE_TOO_LARGE', 'RESPONSE_TOO_LARGE',
    'TIMEOUT_ERROR', 'TIMEOUT_ERROR', 'TIMEOUT_ERROR', 'TIMEOUT_ERROR', 'TIMEOUT_ERROR'
  ])
})
