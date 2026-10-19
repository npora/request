import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/core-entry'

function fragmented(text: string, chunkSize: number) {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  let empty = true
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      // Empty reads must not lose a pending CRLF or UTF-8 code point.
      if (empty) { empty = false; controller.enqueue(new Uint8Array()); return }
      empty = true
      if (offset === bytes.length) { controller.close(); return }
      const end = Math.min(offset + chunkSize, bytes.length)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    }
  }, { highWaterMark: 0 })
}

describe('streaming lines across chunk boundaries', () => {
  it.each([1, 2, 3, 7, 64, 65_536])('preserves mixed line endings and UTF-8 with %i-byte chunks', async chunkSize => {
    const values = ['你好🌍', 'x'.repeat(65_537), 'final']
    const text = '\r\n' + JSON.stringify(values[0]) + '\r\n'
      + JSON.stringify(values[1]) + '\r' + JSON.stringify(values[2])
    const client = createClient({ fetch: async () => new Response(fragmented(text, chunkSize)) })
    const actual = []
    for await (const item of await client.ndjson('https://example.test')) actual.push(item)
    expect(actual).toEqual(values)
  })

  it.each([1, 3, 64, 65_536])('preserves SSE dispatch and CRLF across %i-byte chunks', async chunkSize => {
    const expected = '你好🌍' + 'x'.repeat(65_537)
    const text = `id: first\r\ndata: ${expected}\r\ndata: tail\r\n\r\n`
      + 'data: second\r\rdata: unfinished'
    const client = createClient({ fetch: async () => new Response(fragmented(text, chunkSize)) })
    const actual = []
    for await (const item of await client.sse('https://example.test')) actual.push(item)
    expect(actual).toEqual([
      { data: expected + '\ntail', event: 'message', id: 'first' },
      { data: 'second', event: 'message', id: 'first' }
    ])
  })

  it.each(['\r', '\r\n', '\n', ''])('finishes an NDJSON line ending in %j', async ending => {
    const client = createClient({ fetch: async () => new Response(fragmented('42' + ending, 1)) })
    const actual = []
    for await (const item of await client.ndjson('https://example.test')) actual.push(item)
    expect(actual).toEqual([42])
  })

  it('cancels and unlocks the source while an unfinished long line is buffered', async () => {
    let pulls = 0
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        pulls += 1
        stream.enqueue(new TextEncoder().encode('x'.repeat(64)))
        if (pulls === 20) controller.abort()
      },
      cancel
    }, { highWaterMark: 0 })
    const client = createClient({ fetch: async () => new Response(body) })
    const items = await client.ndjson('https://example.test', { signal: controller.signal })
    await expect(items[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(pulls).toBe(20)
    expect(body.locked).toBe(false)
  })
})
