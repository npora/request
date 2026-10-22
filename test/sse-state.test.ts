import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SseState } from '../src'

afterEach(() => vi.useRealTimers())

const response = () => new Response('data: hello\n\n', {
  headers: { 'content-type': 'text/event-stream' }
})

async function drain(stream: AsyncIterable<unknown>) {
  for await (const _item of stream) { /* consume */ }
}

describe('SSE lifecycle observation', () => {
  it('reports the first connection before the request resolves, and EOF once', async () => {
    const states: SseState[] = []
    const client = createClient({ fetch: async () => response() })
    const pending = client.sse('/events', { onStateChange: state => states.push(state) })
    expect(states).toEqual(['connecting'])
    const stream = await pending
    expect(states).toEqual(['connecting', 'open'])
    await drain(stream)
    expect(states).toEqual(['connecting', 'open', 'closed'])
  })

  it('reports reconnect waits and stops on HTTP 204 without reopening', async () => {
    const states: SseState[] = []
    const fetch = vi.fn().mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await drain(await createClient({ fetch }).sse('/events', {
      reconnect: { maxAttempts: 2, delay: 0 },
      onStateChange: state => states.push(state)
    }))
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'closed'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reports recovered connections and clean exhaustion', async () => {
    const states: SseState[] = []
    await drain(await createClient({ fetch: async () => response() }).sse('/events', {
      reconnect: { maxAttempts: 1, delay: 0 },
      onStateChange: state => states.push(state)
    }))
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open', 'closed'])
  })

  it('closes an unstarted iterator and releases the body', async () => {
    const states: SseState[] = []
    const cancel = vi.fn()
    const stream = await createClient({ fetch: async () => new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'text/event-stream' }
    }) }).sse('/events', { onStateChange: state => states.push(state) })
    await stream[Symbol.asyncIterator]().return?.()
    expect(states).toEqual(['connecting', 'open', 'closed'])
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('closes on an inherited abort even when the consumer is idle', async () => {
    const controller = new AbortController()
    const states: SseState[] = []
    const stream = await createClient({ signal: controller.signal, fetch: async () => response() })
      .sse('/events', { onStateChange: state => states.push(state) })
    controller.abort()
    expect(states).toEqual(['connecting', 'open', 'closed'])
    await stream[Symbol.asyncIterator]().return?.()
    expect(states.at(-1)).toBe('closed')
  })

  it('honors explicitly disabled inherited cancellation', async () => {
    const controller = new AbortController()
    const states: SseState[] = []
    const stream = await createClient({ signal: controller.signal, fetch: async () => response() })
      .sse('/events', { signal: undefined, onStateChange: state => states.push(state) })
    controller.abort()
    expect(states).toEqual(['connecting', 'open'])
    await drain(stream)
    expect(states.at(-1)).toBe('closed')
  })

  it('stops notifying after cancellation during a reconnect wait', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const states: SseState[] = []
    const fetch = vi.fn(async () => response())
    const stream = await createClient({ fetch, signal: controller.signal }).sse('/events', {
      reconnect: { maxAttempts: 3, delay: 1000 },
      onStateChange: state => states.push(state)
    })
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    const pending = iterator.next()
    const failure = expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await failure
    await vi.advanceTimersByTimeAsync(2000)
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'closed'])
    expect(fetch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates synchronous and asynchronous observer failures', async () => {
    for (const onStateChange of [() => { throw Error('UI') }, async () => { throw Error('UI') }]) {
      await drain(await createClient({ fetch: async () => response() }).sse('/events', { onStateChange }))
    }
  })

  it('reports exhausted reconnect failures as errored', async () => {
    const controller = new AbortController()
    const states: SseState[] = []
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockRejectedValue(Error('offline'))
    const stream = await createClient({ fetch, signal: controller.signal }).sse('/events', {
      reconnect: { maxAttempts: 2, delay: 0 }, onStateChange: state => states.push(state)
    })
    await expect(drain(stream)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'errored'])
    controller.abort()
    expect(states.at(-1)).toBe('errored')
  })

  it('reports a schema failure without an extra closed notification', async () => {
    const states: SseState[] = []
    const stream = await createClient({ fetch: async () => response() }).sse('/events', {
      itemSchema: { '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [{ message: 'Invalid' }] }) } },
      onStateChange: state => states.push(state)
    })
    await expect(drain(stream)).rejects.toMatchObject({ code: 'SCHEMA_ERROR' })
    expect(states).toEqual(['connecting', 'open', 'errored'])
  })

  it('closes pre-aborted requests without opening or issuing transport', async () => {
    const controller = new AbortController()
    controller.abort()
    const states: SseState[] = []
    const fetch = vi.fn(async () => response())
    await expect(createClient({ fetch }).sse('/events', {
      signal: controller.signal, onStateChange: state => states.push(state)
    })).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    expect(states).toEqual(['connecting', 'closed'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports initial failures and rejects invalid observers before transport', async () => {
    const states: SseState[] = []
    const fetch = vi.fn(async () => { throw Error('offline') })
    const client = createClient({ fetch })
    await expect(client.sse('/events', { onStateChange: state => states.push(state) }))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(states).toEqual(['connecting', 'errored'])
    await expect(client.sse('/events', { onStateChange: true as never }))
      .rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
