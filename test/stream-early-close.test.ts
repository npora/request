import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/core-entry'

afterEach(() => vi.useRealTimers())

describe('closing a streaming iterator before its first read', () => {
  it.each(['ndjson', 'sse', 'reconnecting sse'].flatMap(format =>
    [false, true].flatMap(deadline => ['return', 'throw'].map(method => ({ format, deadline, method })))
  ))('releases $format on $method (deadline=$deadline)', async ({ format, deadline, method }) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn(async () => new Response(body))
    const client = createClient({ fetch: fetchMock })
    const validate = vi.fn((value: unknown) => ({ value }))
    const config = {
      signal: controller.signal,
      itemSchema: { '~standard': { version: 1 as const, vendor: 'test', validate } },
      ...(deadline ? { timeout: 1000, totalTimeout: 2000 } : {})
    }
    const data = format === 'ndjson'
      ? await client.ndjson('https://example.test', config)
      : await client.sse('https://example.test', {
          ...config,
          ...(format === 'reconnecting sse' ? { reconnect: { maxAttempts: 3 } } : {})
        })
    const iterator = data[Symbol.asyncIterator]()
    expect(body.locked).toBe(true)
    const reason = new Error('consumer stopped')
    if (method === 'throw') await expect(iterator.throw!(reason)).rejects.toBe(reason)
    else await expect(iterator.return!()).resolves.toMatchObject({ done: true })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    for (const [event, listener] of add.mock.calls) {
      expect(remove.mock.calls.some(([removedEvent, removedListener]) => {
        return removedEvent === event && removedListener === listener
      })).toBe(true)
    }
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    await iterator.return!()
    controller.abort()
    await vi.advanceTimersByTimeAsync(3000)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(validate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['return', 'throw'])('preserves %s when source cancellation rejects', async method => {
    const cancel = vi.fn(() => Promise.reject(new Error('source cleanup failed')))
    const body = new ReadableStream<Uint8Array>({ cancel })
    const client = createClient({ fetch: async () => new Response(body) })
    const iterator = (await client.ndjson('https://example.test'))[Symbol.asyncIterator]()
    const reason = new Error('consumer stopped')
    if (method === 'throw') await expect(iterator.throw!(reason)).rejects.toBe(reason)
    else await expect(iterator.return!('closed')).resolves.toEqual({ value: 'closed', done: true })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
  })

  it.each(['return', 'throw'])('waits for shared cleanup when %s races with return', async method => {
    let finish!: () => void
    let notify!: () => void
    const cancelling = new Promise<void>(resolve => { notify = resolve })
    const cancel = vi.fn(() => {
      notify()
      return new Promise<void>(resolve => { finish = resolve })
    })
    const body = new ReadableStream<Uint8Array>({ cancel })
    const client = createClient({ fetch: async () => new Response(body) })
    const iterator = (await client.ndjson('https://example.test'))[Symbol.asyncIterator]()
    let firstCompleted = false
    const reason = new Error('consumer stopped')
    const first = (method === 'throw' ? iterator.throw!(reason) : iterator.return!()).then(
      result => { firstCompleted = true; return result },
      error => { firstCompleted = true; expect(error).toBe(reason) }
    )
    await cancelling
    let secondCompleted = false
    const second = iterator.return!().then(result => { secondCompleted = true; return result })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(firstCompleted).toBe(false)
    expect(secondCompleted).toBe(false)
    finish()
    await Promise.all([first, second])
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })
})
