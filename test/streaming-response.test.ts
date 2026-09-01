import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  createClient,
  type ServerSentEvent,
  type StandardSchemaV1
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
        chunkedResponse(
          source,
          'Text/Event-Stream; Charset=UTF-8',
          [1, 7, 15, 22, 31]
        )
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
        chunkedResponse(
          source,
          'Application/Vnd.Npora+NDJSON; Charset=UTF-8',
          [2, 11, 18, 25]
        )
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

  it('should not detect a stream from a malformed media type substring', async () => {
    const source = 'data: untrusted\n\n'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(source, 'text/event-stream-malformed')
      )
    )

    await expect(createClient().get<string>('/events')).resolves.toBe(source)
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

  it('should validate and transform each NDJSON record lazily', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chunkedResponse(
          '{"id":"1"}\n\n{"id":"2"}\n',
          'application/x-ndjson'
        )
      )
    )
    const schema: StandardSchemaV1<unknown, number> = {
      '~standard': {
        version: 1,
        vendor: 'stream-test',
        async validate(value) {
          return {
            value: Number((value as { id: string }).id)
          }
        }
      }
    }

    const records = await createClient().ndjson('/records', {
      itemSchema: schema
    })

    await expect(collect(records)).resolves.toEqual([1, 2])
  })

  it('should expose NDJSON item and line locations and cancel on failure', async () => {
    const cancel = vi.fn()
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new TextEncoder().encode(
            '{"id":1}\n\n{"id":"invalid"}\n'
          ))
        }
      },
      cancel
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, {
        headers: {
          'content-type': 'application/x-ndjson'
        }
      }))
    )
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'stream-test',
        validate(value) {
          return typeof (value as { id?: unknown }).id === 'number'
            ? { value }
            : {
                issues: [{
                  message: 'Expected a numeric id',
                  path: ['id']
                }]
              }
        }
      }
    }
    const records = await createClient().ndjson('/records', {
      itemSchema: schema
    })
    const iterator = records[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { id: 1 },
      done: false
    })
    await expect(iterator.next()).rejects.toMatchObject({
      name: 'SchemaValidationError',
      code: 'SCHEMA_ERROR',
      message: 'NDJSON item 2 at line 3 schema validation failed',
      schemaVendor: 'stream-test',
      itemIndex: 1,
      lineNumber: 3,
      data: { id: 'invalid' },
      issues: [{ message: 'Expected a numeric id' }]
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('should validate SSE events with event metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chunkedResponse(
        'id: 42\nevent: user\ndata: invalid\n\n',
        'text/event-stream'
      ))
    )
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'stream-test',
        validate() {
          return {
            issues: [{ message: 'Invalid event data' }]
          }
        }
      }
    }
    const events = await createClient().sse('/events', {
      itemSchema: schema
    })

    await expect(collect(events)).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
      message: 'SSE item 1 schema validation failed',
      itemIndex: 0,
      event: 'user',
      eventId: '42',
      data: {
        data: 'invalid',
        event: 'user',
        id: '42'
      }
    })
  })

  it('should preserve an item schema validator failure as the cause', async () => {
    const failure = new Error('validator unavailable')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chunkedResponse(
        '{"id":1}\n',
        'application/x-ndjson'
      ))
    )
    const records = await createClient().ndjson('/records', {
      itemSchema: {
        '~standard': {
          version: 1,
          vendor: 'stream-test',
          validate() {
            throw failure
          }
        }
      }
    })

    await expect(collect(records)).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
      message: 'NDJSON item 1 at line 1 schema validator failed',
      itemIndex: 0,
      lineNumber: 1,
      cause: failure
    })
  })

  it.each([
    {
      name: 'non-object result',
      result: undefined,
      cause: 'Expected a Standard Schema result'
    },
    {
      name: 'non-array issues',
      result: { issues: 'invalid' },
      cause: 'Expected Standard Schema issues to be an array'
    },
    {
      name: 'missing value',
      result: {},
      cause: 'Expected a Standard Schema value'
    }
  ])('should reject a $name from an item schema', async ({ result, cause }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chunkedResponse(
        '{"id":1}\n',
        'application/x-ndjson'
      ))
    )
    const records = await createClient().ndjson('/records', {
      itemSchema: {
        '~standard': {
          version: 1,
          vendor: 'stream-test',
          validate: (() => result) as StandardSchemaV1[
            '~standard'
          ]['validate']
        }
      }
    })

    await expect(collect(records)).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
      message: expect.stringContaining(
        'schema validator returned an invalid result'
      ),
      cause: expect.objectContaining({ message: cause })
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

  it('should release a stream when abort listener registration fails', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      cancel
    })
    const signal = {
      aborted: false,
      addEventListener() {
        throw new Error('listener registration failed')
      },
      removeEventListener: vi.fn()
    } as unknown as AbortSignal

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

    await expect(createClient().ndjson('/records', {
      signal
    })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      cause: expect.objectContaining({
        message: 'listener registration failed'
      })
    })
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1)
    })
  })

  it('should cancel once when listener registration aborts synchronously', async () => {
    const cancel = vi.fn()
    const reason = new Error('synchronous abort')
    const signal = {
      aborted: false,
      reason,
      addEventListener(_type: string, listener: EventListener) {
        this.aborted = true
        listener(new Event('abort'))
      },
      removeEventListener: vi.fn()
    } as unknown as AbortSignal

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: {
            'content-type': 'application/x-ndjson'
          }
        })
      )
    )

    const records = await createClient().ndjson('/records', { signal })

    await expect(collect(records)).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })
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
