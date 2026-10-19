import { expect, test } from '@playwright/test'

for (const chunkSize of [1, 64]) {
  test(`parses fragmented long lines with ${chunkSize}-byte reads`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async chunkSize => {
      const { createClient } = await import('/dist/index.js')
      const value = 'x'.repeat(32_769) + '你好🌍'
      function stream(text: string) {
        const bytes = new TextEncoder().encode(text)
        let offset = 0
        let empty = true
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (empty) { empty = false; controller.enqueue(new Uint8Array()); return }
            empty = true
            if (offset === bytes.length) { controller.close(); return }
            const end = Math.min(offset + chunkSize, bytes.length)
            controller.enqueue(bytes.subarray(offset, end))
            offset = end
          }
        }, { highWaterMark: 0 })
      }
      const ndjson = JSON.stringify(value) + '\r\n' + '42\rtrue'
      const sse = `id: first\r\ndata: ${value}\r\ndata: tail\r\n\r\n`
        + 'data: second\r\rdata: unfinished'
      const client = createClient({
        fetch: async input => new Response(stream(String(input).endsWith('/ndjson') ? ndjson : sse))
      })
      const records = []
      for await (const item of await client.ndjson('/ndjson')) records.push(item)
      const events = []
      for await (const item of await client.sse('/sse')) events.push(item)
      return {
        recordsMatch: JSON.stringify(records) === JSON.stringify([value, 42, true]),
        eventsMatch: JSON.stringify(events) === JSON.stringify([
          { data: value + '\ntail', event: 'message', id: 'first' },
          { data: 'second', event: 'message', id: 'first' }
        ])
      }
    }, chunkSize)
    expect(result).toEqual({ recordsMatch: true, eventsMatch: true })
  })
}
