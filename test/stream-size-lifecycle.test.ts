import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src'

afterEach(() => { vi.useRealTimers() })

describe('bounded Fetch stream lifecycle', () => {
  it.each((['stream', 'sse', 'ndjson'] as const).flatMap(responseType =>
    (['abort', 'timeout', 'totalTimeout'] as const).flatMap(kind =>
      [false, true].map(lateReject => ({ responseType, kind, lateReject }))
    )
  ))(
    'releases idle $responseType on $kind before source cleanup settles (late reject: $lateReject)', async ({ responseType, kind, lateReject }) => {
      vi.useFakeTimers()
      let finishCancel!: () => void
      const cancel = vi.fn(() => new Promise<void>((resolve, reject) => {
        finishCancel = lateReject ? () => reject(new Error('late cleanup failure')) : resolve
      }))
      const controller = new AbortController()
      const source = new ReadableStream<Uint8Array>({
        pull(stream) { stream.enqueue(new TextEncoder().encode('data: queued\n\n')) },
        cancel
      }, { highWaterMark: 0 })
      const response = await createClient({ fetch: async () => new Response(source) })
        .getResponse<ReadableStream<Uint8Array> | AsyncIterable<unknown>>('https://example.test/idle', {
          responseType, signal: controller.signal, maxResponseSize: 100,
          timeout: kind === 'totalTimeout' ? 0 : 1000,
          totalTimeout: kind === 'totalTimeout' ? 1000 : undefined
        })
      try {
        // Allow one prefetched chunk to fill the wrapper, leaving no pending read.
        await vi.advanceTimersByTimeAsync(0)
        if (kind === 'abort') controller.abort()
        await vi.advanceTimersByTimeAsync(kind === 'abort' ? 0 : 1000)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(source.locked).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
        const consume = async () => {
          if (response.data instanceof ReadableStream) {
            const reader = response.data.getReader()
            try { await reader.read() } finally { reader.releaseLock() }
          } else {
            for await (const value of response.data) void value
          }
        }
        await expect(consume()).rejects.toMatchObject({
          code: kind === 'abort' ? 'ABORT_ERROR' : 'TIMEOUT_ERROR'
        })
      } finally {
        finishCancel?.()
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

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

  it('reports an oversized stream before source cleanup settles, preserving the first error', async () => {
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
      const rejected = expect(pending).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
      // Drain source pull/read continuations without resolving its cancel promise.
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledTimes(1)
      await rejected
      expect(source.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      controller.abort(new Error('view closed'))
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
