import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src'

afterEach(() => { vi.useRealTimers() })

describe('bounded Fetch stream lifecycle', () => {
  it.each(['stream', 'sse', 'ndjson'] as const)(
    'keeps %s size errors authoritative when source cancellation rejects', async responseType => {
      vi.useFakeTimers()
      const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'))
      const source = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(16)) },
        cancel
      }, { highWaterMark: 0 })
      const api = createClient({ fetch: async () => new Response(source) })
      const response = await api.getResponse<ReadableStream<Uint8Array> | AsyncIterable<unknown>>(
        'https://example.test/stream', { responseType, maxResponseSize: 8, timeout: 1000 }
      )
      const consume = async () => {
        if (response.data instanceof ReadableStream) {
          const reader = response.data.getReader()
          try { await reader.read() } finally { reader.releaseLock() }
        } else {
          for await (const value of response.data) void value
        }
      }
      await expect(consume()).rejects.toMatchObject({
        code: 'RESPONSE_TOO_LARGE', status: 200
      })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(cancel.mock.calls[0]?.[0]).toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
      expect(source.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('rejects oversized headers and releases the attempt timer before returning data', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    const api = createClient({ fetch: async () => new Response(source, {
      headers: { 'content-type': 'application/x-ndjson', 'content-length': '100' }
    }) })
    await expect(api.getResponse('https://example.test/records', {
      maxResponseSize: 8, timeout: 1000
    })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', status: 200 })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(source.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('can abort while an oversized stream is waiting for source cancellation', async () => {
    vi.useFakeTimers()
    let finishCancel!: () => void
    const cancel = vi.fn(() => new Promise<void>(resolve => { finishCancel = resolve }))
    const controller = new AbortController()
    const source = new ReadableStream<Uint8Array>({
      pull(stream) { stream.enqueue(new Uint8Array(16)) }, cancel
    }, { highWaterMark: 0 })
    const api = createClient({ fetch: async () => new Response(source) })
    const stream = await api.get<ReadableStream<Uint8Array>>('https://example.test/stream', {
      responseType: 'stream', maxResponseSize: 8, timeout: 1000, signal: controller.signal
    })
    const reader = stream.getReader()
    try {
      const pending = reader.read()
      const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
      // Drain source pull/read continuations without resolving its cancel promise.
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledTimes(1)
      controller.abort(new Error('view closed'))
      await rejected
      finishCancel()
      await vi.advanceTimersByTimeAsync(0)
      expect(source.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      finishCancel?.()
      reader.releaseLock()
    }
  })

  it('keeps timeout enforcement while a bounded complete stream is idle', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    const api = createClient({ fetch: async () => new Response(source) })
    const response = await api.getResponse<ReadableStream<Uint8Array>>('https://example.test/idle', {
      responseType: 'stream', maxResponseSize: 8, timeout: 10
    })
    const reader = response.data.getReader()
    try {
      const rejected = expect(reader.read()).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' })
      await vi.advanceTimersByTimeAsync(10)
      await rejected
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(source.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally { reader.releaseLock() }
  })
})
