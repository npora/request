import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/core-entry'

afterEach(() => vi.useRealTimers())

describe('closing a streaming iterator with a pending read', () => {
  it.each(['ndjson', 'sse', 'observed sse', 'reconnecting sse'])(
    'closes the owned custom-adapter iterator for %s', async format => {
      let entered!: () => void
      const waiting = new Promise<void>(resolve => { entered = resolve })
      const iterators: AsyncIterator<unknown>[] = []
      const data = { [Symbol.asyncIterator]() {
        let finish: ((value: IteratorResult<unknown>) => void) | undefined
        const iterator: AsyncIterator<unknown> = {
          next() { return new Promise(resolve => { finish = resolve; entered() }) },
          async return(value) { finish?.({ done: true, value: undefined }); return { done: true, value } }
        }
        iterators.push(iterator)
        return iterator
      } }
      const api = createClient({ adapter: { async request<T>(config) {
        return { data: data as T, status: 200, statusText: 'OK', headers: new Headers(), config, raw: new Response() }
      } } })
      const config = { totalTimeout: 1000 }
      const stream = format === 'ndjson' ? await api.ndjson('/stream', config)
        : await api.sse('/stream', { ...config,
            ...(format === 'observed sse' ? { onStateChange() {} } : {}),
            ...(format === 'reconnecting sse' ? { reconnect: { maxAttempts: 3 } } : {}) })
      const iterator = stream[Symbol.asyncIterator]()
      const reading = iterator.next().catch(error => ({ error }))
      await waiting
      const closing = iterator.return!('finished')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([closing, new Promise<'pending'>(resolve => {
          timer = setTimeout(() => resolve('pending'), 50)
        })])
        expect(result).toEqual({ done: true, value: 'finished' })
        await expect(reading).resolves.toMatchObject({ done: true })
        expect(iterators).toHaveLength(1)
      } finally {
        clearTimeout(timer)
        await Promise.allSettled(iterators.map(source => source.return?.()))
        await Promise.allSettled([reading, closing])
      }
    }
  )

  it.each(['ndjson', 'sse', 'observed sse', 'reconnecting sse'].flatMap(format =>
    ['read', 'schema'].flatMap(stage => ['return', 'throw'].map(method => ({ format, stage, method })))
  ))('interrupts $format during $stage on $method', async ({ format, stage, method }) => {
    let entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const cancel = vi.fn()
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (stage === 'schema') controller.enqueue(encoder.encode(format === 'ndjson' ? '{"id":1}\n' : 'data: hello\n\n'))
      },
      pull() { if (stage === 'read') entered() },
      cancel
    })
    const controller = new AbortController()
    const states: string[] = []
    const fetch = vi.fn(async () => new Response(body))
    const api = createClient({ fetch })
    const config = {
      signal: controller.signal,
      timeout: 1000,
      totalTimeout: 2000,
      ...(stage === 'schema' ? { itemSchema: {
        '~standard': { version: 1 as const, vendor: 'test', validate() {
          entered()
          return new Promise<{ value: unknown }>(() => {})
        } }
      } } : {})
    }
    const data = format === 'ndjson' ? await api.ndjson('/stream', config)
      : await api.sse('/stream', { ...config,
          ...(format === 'observed sse' ? { onStateChange: (state: string) => { states.push(state) } } : {}),
          ...(format === 'reconnecting sse' ? { reconnect: { maxAttempts: 3, delay: 1000 } } : {}) })
    const iterator = data[Symbol.asyncIterator]()
    const reading = iterator.next().then(value => value, error => ({ error }))
    await waiting
    const reason = new Error('consumer stopped')
    const closing = (method === 'return' ? iterator.return!('finished') : iterator.throw!(reason))
      .then(value => ({ value }), error => ({ error }))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([closing, new Promise<'pending'>(resolve => {
        timer = setTimeout(() => resolve('pending'), 50)
      })])
      expect(result).not.toBe('pending')
      if (method === 'return') expect(result).toEqual({ value: { value: 'finished', done: true } })
      else expect(result).toEqual({ error: reason })
      await expect(reading).resolves.toMatchObject({ done: true })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(body.locked).toBe(false)
      expect(controller.signal.aborted).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
      if (states.length) expect(states).toEqual(['connecting', 'open', 'closed'])
    } finally {
      clearTimeout(timer)
      controller.abort()
      await Promise.allSettled([reading, closing])
    }
  })

  it.each(['reject', 'never'])('releases an active read even when source cancellation will %s', async outcome => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => outcome === 'reject'
      ? Promise.reject(new Error('source cleanup failed'))
      : new Promise<void>(() => {}))
    const body = new ReadableStream<Uint8Array>({ cancel })
    const api = createClient({ fetch: async () => new Response(body) })
    const stream = await api.ndjson('/stream', { timeout: 1000, totalTimeout: 2000 })
    const iterator = stream[Symbol.asyncIterator]()
    const reading = iterator.next()
    const closing = iterator.return!()
    await vi.advanceTimersByTimeAsync(0)
    await expect(closing).resolves.toMatchObject({ done: true })
    await expect(reading).resolves.toMatchObject({ done: true })
    expect(body.locked).toBe(false)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['delay', 'connect'].flatMap(stage => ['return', 'throw'].map(method => ({ stage, method }))))(
    'interrupts reconnect $stage on $method without another attempt', async ({ stage, method }) => {
      vi.useFakeTimers()
      let entered!: () => void
      const waiting = new Promise<void>(resolve => { entered = resolve })
      const controller = new AbortController()
      const states: string[] = []
      const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (fetch.mock.calls.length === 1) return new Response('')
        entered()
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
        })
      })
      const api = createClient({ fetch })
      const stream = await api.sse('/stream', {
        signal: controller.signal,
        reconnect: { maxAttempts: 3, delay: stage === 'delay' ? 10000 : 0 },
        onStateChange(state) {
          states.push(state)
          if (stage === 'delay' && state === 'reconnecting') entered()
        }
      })
      const iterator = stream[Symbol.asyncIterator]()
      const reading = iterator.next().then(value => value, error => ({ error }))
      await waiting
      const reason = new Error('stop reconnect')
      const closing = (method === 'return' ? iterator.return!('finished') : iterator.throw!(reason))
        .then(value => ({ value }), error => ({ error }))
      try {
        await vi.advanceTimersByTimeAsync(0)
        const result = await Promise.race([closing, Promise.resolve('pending')])
        expect(result).not.toBe('pending')
        if (method === 'return') expect(result).toEqual({ value: { value: 'finished', done: true } })
        else expect(result).toEqual({ error: reason })
        await expect(reading).resolves.toMatchObject({ done: true })
        expect(states.at(-1)).toBe('closed')
        expect(states).not.toContain('errored')
        expect(controller.signal.aborted).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(60000)
        expect(fetch).toHaveBeenCalledTimes(stage === 'delay' ? 1 : 2)
      } finally {
        controller.abort()
        await Promise.allSettled([reading, closing])
      }
    }
  )
})
