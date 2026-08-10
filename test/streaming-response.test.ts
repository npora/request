import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  createClient,
  type ServerSentEvent
} from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streaming response parsing', () => {
  it('should parse fragmented server-sent events', async () => {
    const source = [
      ': keep-alive\r\n',
      'id: event-1\r',
      'data: 你好\r\n',
      'data: world\r\n',
      'retry: 1500\r\n',
      '\r\n',
      'event: update\n',
      'data: second\n',
      '\n'
    ].join('')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(source, 'text/event-stream', [1, 7, 15, 22, 31])
      )
    )

    const request = createClient()
    const events = await request.get<AsyncIterable<ServerSentEvent>>('/events')

    await expect(collect(events)).resolves.toEqual([
      {
        data: '你好\nworld',
        event: 'message',
        id: 'event-1',
        retry: 1500
      },
      {
        data: 'second',
        event: 'update',
        id: 'event-1',
        retry: 1500
      }
    ])
  })

  it('should follow SSE field and dispatch rules', async () => {
    const source = [
      'retry: invalid\n',
      'id: ignored\0id\n',
      'data\n',
      'unknown: ignored\n',
      '\n',
      'event:\n',
      'id:\n',
      'data: final\n',
      '\n',
      'data: incomplete'
    ].join('')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(source, 'text/plain')
      )
    )

    const events = await createClient().get<
      AsyncIterable<ServerSentEvent>
    >('/events', {
      responseType: 'sse'
    })

    await expect(collect(events)).resolves.toEqual([
      {
        data: '',
        event: 'message',
        id: ''
      },
      {
        data: 'final',
        event: 'message',
        id: ''
      }
    ])
  })

  it('should parse fragmented NDJSON and a final unterminated line', async () => {
    const source = [
      '{"id":1,"name":"你好"}\r\n',
      '\n',
      '{"id":2,"name":"world"}'
    ].join('')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(source, 'application/x-ndjson', [2, 11, 18, 25])
      )
    )

    const records = await createClient().get<
      AsyncIterable<{ id: number; name: string }>
    >('/records')

    await expect(collect(records)).resolves.toEqual([
      { id: 1, name: '你好' },
      { id: 2, name: 'world' }
    ])
  })

  it('should report the invalid NDJSON line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(
          '{"ok":true}\nnot-json\n',
          'application/ndjson'
        )
      )
    )

    const records = await createClient().get<AsyncIterable<unknown>>(
      '/records'
    )
    const iterator = records[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { ok: true },
      done: false
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'PARSER_ERROR',
      message: 'Failed to parse NDJSON at line 2',
      status: 200
    })
  })

  it('should cancel the response reader when iteration stops early', async () => {
    const cancel = vi.fn()
    const encoder = new TextEncoder()
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(encoder.encode('{"id":1}\n'))
        }
      },
      cancel
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: {
            'content-type': 'application/x-ndjson'
          }
        })
      )
    )

    const records = await createClient().get<AsyncIterable<{ id: number }>>(
      '/records'
    )

    for await (const record of records) {
      expect(record).toEqual({ id: 1 })
      break
    }

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('should enforce maxResponseSize during streaming iteration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(
          '{"id":1}\n{"id":2}\n',
          'application/x-ndjson',
          [9]
        )
      )
    )

    const records = await createClient().get<AsyncIterable<{ id: number }>>(
      '/records',
      {
        maxResponseSize: 12
      }
    )

    await expect(collect(records)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE'
    })
  })

  it('should wrap interrupted streaming reads as parser errors', async () => {
    const failure = new Error('socket closed')
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1

        if (reads === 1) {
          controller.enqueue(new TextEncoder().encode('{"id":1}\n'))
          return
        }

        controller.error(failure)
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: {
            'content-type': 'application/x-ndjson'
          }
        })
      )
    )

    const records = await createClient().get<AsyncIterable<{ id: number }>>(
      '/records'
    )
    const iterator = records[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { id: 1 }
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'PARSER_ERROR',
      cause: failure
    })
  })

  it('should keep timeout enforcement active while a stream is consumed', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":1}\n'))
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: {
            'content-type': 'application/x-ndjson'
          }
        })
      )
    )

    const records = await createClient().ndjson<{ id: number }>(
      '/records',
      {
        timeout: 10
      }
    )
    const iterator = records[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { id: 1 }
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })
  })

  it('should keep external cancellation active while a stream is consumed', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(
          new TextEncoder().encode('{"id":1}\n')
        )
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: {
            'content-type': 'application/x-ndjson'
          }
        })
      )
    )

    const records = await createClient().ndjson<{ id: number }>(
      '/records',
      {
        signal: controller.signal,
        timeout: 1000
      }
    )
    const iterator = records[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { id: 1 }
    })

    controller.abort()

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
  })
})

function chunkedResponse(
  source: string,
  contentType: string,
  splitOffsets: number[] = []
): Response {
  const bytes = new TextEncoder().encode(source)
  const offsets = [0, ...splitOffsets, bytes.byteLength]
    .filter((offset, index, values) => {
      return offset >= 0 &&
        offset <= bytes.byteLength &&
        values.indexOf(offset) === index
    })
    .sort((left, right) => left - right)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 1; index < offsets.length; index += 1) {
        controller.enqueue(bytes.slice(offsets[index - 1], offsets[index]))
      }

      controller.close()
    }
  })

  return new Response(body, {
    headers: {
      'content-type': contentType
    }
  })
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []

  for await (const value of source) {
    values.push(value)
  }

  return values
}
