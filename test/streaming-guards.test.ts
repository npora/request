import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, type RequestConfig, type StandardSchemaV1 } from '../src'

const bytes = (text: string) => new TextEncoder().encode(text)
const identity: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'guard-test', validate: value => ({ value }) }
}
const collect = async (iterable: AsyncIterable<unknown>) => {
  const result = []
  for await (const value of iterable) result.push(value)
  return result
}
function client(text: string, cuts: number[] = []) {
  const encoded = bytes(text)
  return createClient({ fetch: async () => new Response(new ReadableStream({
    start(controller) {
      let offset = 0
      for (const cut of [...cuts, encoded.length]) {
        controller.enqueue(encoded.slice(offset, cut))
        offset = cut
      }
      controller.close()
    }
  })) })
}
afterEach(() => vi.useRealTimers())

describe('streaming parser guards', () => {
  it.each((['sse', 'ndjson'] as const).flatMap(responseType =>
    (['abort', 'timeout', 'totalTimeout'] as const).flatMap(kind =>
      [false, true].map(schema => ({ responseType, kind, schema }))))) (
  'discards decoded $responseType records after $kind (schema: $schema)',
  async ({ responseType, kind, schema }) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const text = responseType === 'sse' ? 'data: 1\n\ndata: 2\n\n' : '1\n2\n'
    const api = createClient({ fetch: async () => new Response(new ReadableStream({
      start(c) { c.enqueue(bytes(text)) }
    })) })
    const iterable = await api.get<AsyncIterable<unknown>>('https://example.test/', {
      responseType, signal: controller.signal, itemSchema: schema ? identity : undefined,
      timeout: kind === 'timeout' ? 100 : undefined,
      totalTimeout: kind === 'totalTimeout' ? 100 : undefined
    })
    const iterator = iterable[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    if (kind === 'abort') controller.abort()
    else await vi.advanceTimersByTimeAsync(100)
    await expect(iterator.next()).rejects.toMatchObject({
      code: kind === 'abort' ? 'ABORT_ERROR' : 'TIMEOUT_ERROR'
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps total timeout active during schema validation after transport EOF', async () => {
    vi.useFakeTimers()
    const schema: StandardSchemaV1 = {
      '~standard': { version: 1, vendor: 'pending', validate: () => new Promise(() => {}) }
    }
    const iterable = await client('1\n').ndjson('https://example.test/', {
      timeout: 1000, totalTimeout: 100, itemSchema: schema
    })
    const pending = iterable[Symbol.asyncIterator]().next()
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' })
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases parser limit resources before a source cancel promise settles', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const source = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes('12345')) }, cancel
    })
    const iterable = await createClient({ fetch: async () => new Response(source) })
      .ndjson('https://example.test/', { maxStreamLineSize: 4, timeout: 1000, totalTimeout: 2000 })
    await expect(collect(iterable)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(source.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks cancellation even after the source has reached EOF', async () => {
    const controller = new AbortController()
    const iterable = await client('1\n2\n').ndjson('https://example.test/', { signal: controller.signal })
    const iterator = iterable[Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ABORT_ERROR' })
  })

  it.each(['\n', '\r', '\r\n'])('counts UTF-8 line bytes excluding %j', async delimiter => {
    const text = `"你好"${delimiter}1${delimiter}` // 8 UTF-8 bytes in the first line
    expect(await collect(await client(text, [2, 3, 4, 6, 8, 9]).ndjson('https://example.test/', {
      maxStreamLineSize: 8
    }))).toEqual(['你好', 1])
    await expect(collect(await client(text, [2, 3, 4, 6]).ndjson('https://example.test/', {
      maxStreamLineSize: 7
    }))).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('bounds unterminated lines, zero limits, and explicit Infinity', async () => {
    await expect(collect(await client('12345', [1, 2, 3]).ndjson('https://example.test/', {
      maxStreamLineSize: 4
    }))).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    expect(await collect(await client('\n\n').ndjson('https://example.test/', { maxStreamLineSize: 0 }))).toEqual([])
    await expect(collect(await client('1').ndjson('https://example.test/', {
      maxStreamLineSize: 0
    }))).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    expect(await collect(await client('12345').ndjson('https://example.test/', {
      maxStreamLineSize: Infinity
    }))).toEqual([12345])
  })

  it('bounds cumulative SSE fields and resets the size at each event', async () => {
    const text = 'data: 你\ndata: a\n\ndata: 你\ndata: a\n\n' // 9 + 7 bytes per event
    const events = await collect(await client(text, [7, 8, 11]).sse('https://example.test/', {
      maxSseEventSize: 16, maxStreamLineSize: 9
    }))
    expect(events).toHaveLength(2)
    await expect(collect(await client(text).sse('https://example.test/', {
      maxSseEventSize: 15
    }))).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    await expect(collect(await client(': keepalive\nid: 123\n').sse('https://example.test/', {
      maxSseEventSize: 12
    }))).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('bounds an unterminated SSE line against the remaining event budget', async () => {
    const cancel = vi.fn()
    const api = createClient({ fetch: async () => new Response(new ReadableStream({
      start(c) { c.enqueue(bytes('data: a\ndata: too-long')) }, cancel
    })) })
    await expect(collect(await api.sse('https://example.test/', { maxSseEventSize: 10 })))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', message: expect.stringContaining('maxSseEventSize') })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each(['maxStreamLineSize', 'maxSseEventSize', 'streamIdleTimeout'] as const)(
    'validates %s before calling the transport', async option => {
      const fetch = vi.fn()
      const api = createClient({ fetch })
      for (const value of [-1, NaN, '10', null, option === 'streamIdleTimeout' ? Infinity : 0.5]) {
        await expect(api.get('https://example.test/', { [option]: value } as unknown as RequestConfig))
          .rejects.toMatchObject({ code: 'CONFIG_ERROR' })
      }
      expect(fetch).not.toHaveBeenCalled()
    })
})

describe('stream idle timeout', () => {
  it.each(['stream', 'sse', 'ndjson'] as const)(
    'times out a stalled %s without waiting for source cleanup', async responseType => {
      vi.useFakeTimers()
      const cancel = vi.fn(() => new Promise<void>(() => {}))
      const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
      const api = createClient({ streamIdleTimeout: 50, fetch: async () => new Response(source) })
      const response = await api.getResponse<ReadableStream | AsyncIterable<unknown>>('https://example.test/', {
        responseType, totalTimeout: 1000
      })
      const pending = response.data instanceof ReadableStream
        ? response.data.getReader().read()
        : response.data[Symbol.asyncIterator]().next()
      const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT_ERROR', status: 200 })
      await vi.advanceTimersByTimeAsync(50)
      await assertion
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(source.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })

  it('resets on chunks and pauses for consumer backpressure', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const source = new ReadableStream<Uint8Array>({ start(c) { controller = c } }, { highWaterMark: 0 })
    const data = await createClient({ fetch: async () => new Response(source) })
      .get<ReadableStream>('https://example.test/', { responseType: 'stream', streamIdleTimeout: 50 })
    const reader = data.getReader()
    const first = reader.read()
    await vi.advanceTimersByTimeAsync(40)
    controller.enqueue(bytes('a'))
    await first
    await vi.advanceTimersByTimeAsync(40)
    controller.enqueue(bytes('b'))
    await vi.advanceTimersByTimeAsync(500)
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('b')
    controller.close()
    expect((await reader.read()).done).toBe(true)
    reader.releaseLock()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows per-call disabling and clears pending timers on cancellation', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const api = createClient({ streamIdleTimeout: 50, fetch: async () => new Response(new ReadableStream()) })
    const data = await api.get<ReadableStream>('https://example.test/', {
      responseType: 'stream', streamIdleTimeout: 0, signal: abort.signal
    })
    await vi.advanceTimersByTimeAsync(500)
    const reader = data.getReader()
    const assertion = expect(reader.read()).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    abort.abort()
    await assertion
    reader.releaseLock()
    expect(vi.getTimerCount()).toBe(0)
  })
})
