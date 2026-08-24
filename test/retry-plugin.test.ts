import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  RequestError,
  retryPlugin
} from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('retryPlugin', () => {
  it('should retry when request fails with 500', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Server Error' }), {
          status: 500,
          statusText: 'Server Error',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(retryPlugin())

    const data = await request.get<{ ok: boolean }>('/retry', {
      extensions: {
        retry: {
          retries: 1,
          delay: 0
        }
      }
    })

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should read retry options from extensions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Server Error' }), {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(retryPlugin())

    await expect(
      request.get('/retry', {
        extensions: {
          retry: {
            retries: 1,
            delay: 0
          }
        }
      })
    ).resolves.toEqual({
      ok: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not retry when retries is 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Server Error' }), {
        status: 500,
        statusText: 'Server Error',
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(retryPlugin())

    await expect(
      request.get('/retry', {
        extensions: {
          retry: 0
        }
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should respect default retry options from plugin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Server Error' }), {
          status: 500,
          statusText: 'Server Error',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0
      })
    )

    const data = await request.get<{ ok: boolean }>('/retry')

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not retry non-idempotent methods by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Server Error' }), {
        status: 500,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0
      })
    )

    await expect(
      request.post('/orders', {
        json: {
          item: 'book'
        }
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should allow explicitly retrying a non-idempotent method', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Server Error' }), {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        methods: ['POST'],
        delay: 0
      })
    )

    await expect(
      request.post('/orders', {
        json: {
          item: 'book'
        }
      })
    ).resolves.toEqual({
      ok: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not retry a streaming request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', {
        status: 503
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        methods: ['POST'],
        delay: 0
      })
    )
    const body = new ReadableStream({
      start(controller) {
        controller.close()
      }
    })

    await expect(request.post('/upload', {
      body,
      responseType: 'text'
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      duplex: 'half'
    })
  })

  it('should respect Retry-After and maxDelay', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Busy' }), {
          status: 503,
          headers: {
            'content-type': 'application/json',
            'retry-after': '10'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0,
        maxDelay: 1000,
        jitter: () => 1
      })
    )

    const promise = request.get('/busy')

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    '-1',
    '2099-01-01T00:00:00Z',
    'November 6, 2099 08:49:37 GMT'
  ])('should ignore invalid Retry-After value %s', async retryAfter => {
    vi.useFakeTimers()

    const controller = new AbortController()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503,
          headers: {
            'retry-after': retryAfter
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({ retries: 1, delay: 100 })
    )
    const outcome = request.get('/busy', {
      signal: controller.signal
    }).catch(error => error)

    await vi.advanceTimersByTimeAsync(99)
    const callsBeforeDelay = fetchMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(1)
    const callsAfterDelay = fetchMock.mock.calls.length

    controller.abort()
    await outcome

    expect(callsBeforeDelay).toBe(1)
    expect(callsAfterDelay).toBe(2)
  })

  it('should respect a valid Retry-After HTTP date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00Z'))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503,
          headers: {
            'retry-after': new Date(Date.now() + 1000).toUTCString()
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({ retries: 1, delay: 0 })
    )
    const promise = request.get('/busy')

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('should cap retry delays at the platform timer limit', async () => {
    vi.useFakeTimers()

    const controller = new AbortController()
    let observeDelay!: (delay: number) => void
    const scheduled = new Promise<number>(resolve => {
      observeDelay = resolve
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', { status: 503 })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: Number.MAX_SAFE_INTEGER,
        maxDelay: Number.MAX_SAFE_INTEGER,
        onRetry(event) {
          observeDelay(event.delay)
        }
      })
    )
    const outcome = request.get('/busy', {
      signal: controller.signal
    }).catch(error => error)
    const delay = await scheduled

    controller.abort()

    await outcome
    expect(delay).toBe(2_147_483_647)
  })

  it('should apply custom jitter and emit a retry event', async () => {
    vi.useFakeTimers()

    const jitter = vi.fn(event => event.delay / 4)
    const onRetry = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 100,
        jitter,
        onRetry
      })
    )

    const promise = request.get('/busy')

    await vi.advanceTimersByTimeAsync(24)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toEqual({
      ok: true
    })
    expect(jitter).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        delay: 100,
        elapsedTime: expect.any(Number),
        error: expect.any(RequestError)
      })
    )
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        delay: 25,
        elapsedTime: expect.any(Number),
        error: expect.any(RequestError)
      })
    )
  })

  it('should apply full jitter when enabled', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 100,
        jitter: true
      })
    )

    const promise = request.get('/busy')

    await vi.advanceTimersByTimeAsync(49)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toEqual({
      ok: true
    })
  })

  it('should not jitter a server Retry-After delay', async () => {
    vi.useFakeTimers()

    const jitter = vi.fn(() => 0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503,
          headers: {
            'retry-after': '1'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0,
        jitter
      })
    )

    const promise = request.get('/busy')

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toEqual({
      ok: true
    })
    expect(jitter).not.toHaveBeenCalled()
  })

  it('should stop when the planned delay exceeds the elapsed-time budget', async () => {
    const onRetry = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', {
        status: 503
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 2,
        delay: 100,
        maxElapsedTime: 50,
        onRetry
      })
    )

    await expect(request.get('/busy')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('should count request execution against the elapsed-time budget', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)

    const fetchMock = vi.fn().mockImplementation(() => {
      vi.setSystemTime(1200)

      return Promise.resolve(
        new Response('Busy', {
          status: 503
        })
      )
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0,
        maxElapsedTime: 150
      })
    )

    await expect(request.get('/slow')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should isolate retries from observer failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 0,
        async onRetry() {
          throw new Error('observer failed')
        }
      })
    )

    await expect(request.get('/busy')).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should abort immediately during retry delay', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Server Error' }), {
        status: 500,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({
        retries: 1,
        delay: 10000
      })
    )

    const promise = request.get('/retry', {
      signal: controller.signal
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    controller.abort(
      new RequestError('Cancelled by user', {
        code: 'ABORT_ERROR'
      })
    )

    await expect(promise).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Cancelled by user'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should abort while an asynchronous retry decision is pending', async () => {
    const shouldRetry = vi.fn(() => new Promise<boolean>(() => {}))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', { status: 503 })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(retryPlugin({
      retries: 1,
      shouldRetry
    }))
    const controller = new AbortController()
    const pending = request.get('/pending-retry-policy', {
      signal: controller.signal
    }).catch(error => error)

    await vi.waitFor(() => {
      expect(shouldRetry).toHaveBeenCalledTimes(1)
    })

    controller.abort('cancel retry policy')

    const outcome = await Promise.race([
      pending,
      new Promise<'still-pending'>(resolve => {
        setTimeout(() => resolve('still-pending'), 25)
      })
    ])

    expect(outcome).toMatchObject({ code: 'ABORT_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not retain a retry timer when listener setup fails', async () => {
    vi.useFakeTimers()

    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      addEventListener() {
        throw new Error('listener setup failed')
      },
      removeEventListener
    } as unknown as AbortSignal
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', { status: 503 })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({ retries: 1, delay: 1000 })
    )

    await expect(request.get('/busy', { signal })).rejects.toThrow(
      'listener setup failed'
    )
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('should not allocate a retry timer after synchronous abort', async () => {
    vi.useFakeTimers()

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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', { status: 503 })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      retryPlugin({ retries: 1, delay: 1000 })
    )

    await expect(request.get('/busy', { signal })).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('should remove the retry listener when timer setup fails', async () => {
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener
    } as unknown as AbortSignal
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Busy', { status: 503 })
    )

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw new Error('timer setup failed')
    })

    const request = createClient().use(
      retryPlugin({ retries: 1, delay: 1000 })
    )

    await expect(request.get('/busy', { signal })).rejects.toThrow(
      'timer setup failed'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('should clear a handle returned by a synchronous retry timer', async () => {
    const removeEventListener = vi.fn()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener
    } as unknown as AbortSignal
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', { status: 503 })
      )
      .mockResolvedValueOnce(
        new Response('{"ok":true}', {
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(callback => {
      callback()
      return 1 as unknown as ReturnType<typeof setTimeout>
    })

    const request = createClient().use(
      retryPlugin({ retries: 1, delay: 1000 })
    )

    await expect(request.get('/busy', { signal })).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })
})
