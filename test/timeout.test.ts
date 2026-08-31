import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, RequestError, retryPlugin } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('timeout and abort', () => {
  it('should enforce totalTimeout across retry delays', async () => {
    vi.useFakeTimers()

    try {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 })
      )

      vi.stubGlobal('fetch', fetchMock)

      const request = createClient().use(retryPlugin({
        retries: 2,
        delay: 100
      }))
      const pending = request.get('/total-timeout', {
        totalTimeout: 50
      })
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR',
        message: 'Request total timeout after 50ms'
      })

      await vi.advanceTimersByTimeAsync(50)

      await rejection
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should enforce totalTimeout while a request interceptor is pending', async () => {
    vi.useFakeTimers()

    try {
      const fetchMock = vi.fn()

      vi.stubGlobal('fetch', fetchMock)

      const request = createClient()

      request.interceptors.request.use(async config => {
        await new Promise(() => {})
        return config
      })

      const pending = request.get('/pending-hook', {
        totalTimeout: 25
      })
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR'
      })

      await vi.advanceTimersByTimeAsync(25)

      await rejection
      expect(fetchMock).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should keep totalTimeout active until a response stream settles', async () => {
    vi.useFakeTimers()

    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response('streamed')
      ))

      const stream = await createClient().get<ReadableStream<Uint8Array>>(
        '/stream',
        {
          responseType: 'stream',
          totalTimeout: 1000
        }
      )

      expect(vi.getTimerCount()).toBe(1)
      await new Response(stream).text()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should abort stream consumption when totalTimeout expires', async () => {
    vi.useFakeTimers()

    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>())
      ))

      const stream = await createClient().get<ReadableStream<Uint8Array>>(
        '/pending-stream',
        {
          responseType: 'stream',
          totalTimeout: 25
        }
      )
      const reading = expect(stream.getReader().read()).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR'
      })

      await vi.advanceTimersByTimeAsync(25)

      await reading
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should clear totalTimeout after a buffered response', async () => {
    vi.useFakeTimers()

    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response('ok')
      ))

      await expect(createClient().get('/buffered', {
        totalTimeout: 1000
      })).resolves.toBe('ok')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should prioritize totalTimeout while parsing HTTP error data', async () => {
    vi.useFakeTimers()

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('{"message":"busy"}', {
            status: 503,
            headers: { 'content-type': 'application/json' }
          })
        )
      )

      const pending = createClient().get('/error-parser', {
        totalTimeout: 25,
        parseJson: () => new Promise(() => {})
      })
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR'
      })

      await vi.advanceTimersByTimeAsync(25)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('should throw TIMEOUT_ERROR when request exceeds timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason)
          })
        })
      })
    )

    const request = createClient({
      timeout: 10
    })

    await expect(request.get('/timeout')).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })
  })

  it('should allow request when timeout is not exceeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const request = createClient({
      timeout: 1000
    })

    const data = await request.get<{ ok: boolean }>('/success')

    expect(data).toEqual({ ok: true })
  })

  it('should support external abort signal', async () => {
    const controller = new AbortController()

    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason)
          })
        })
      })
    )

    const request = createClient()

    const promise = request.get('/abort', {
      signal: controller.signal
    })

    setTimeout(() => {
      controller.abort(
        new RequestError('User aborted', {
          code: 'ABORT_ERROR'
        })
      )
    }, 0)

    await expect(promise).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
  })
})
