import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Adapter,
  NporaResponse,
  RequestConfig
} from '../src'
import {
  createClient,
  rateLimitPlugin,
  RequestError,
  retryPlugin
} from '../src'

afterEach(() => {
  vi.useRealTimers()
})

describe('rateLimitPlugin', () => {
  it('should enforce a strict rolling limit and FIFO admission', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const adapter = new RecordingAdapter()
    const limiter = rateLimitPlugin({
      maxRequests: 2,
      interval: 1000
    })
    const client = createClient({ adapter }).use(limiter)
    const requests = [
      client.get('/one'),
      client.get('/two'),
      client.get('/three'),
      client.get('/four')
    ]

    await flush()
    expect(adapter.started).toEqual(['/one', '/two'])
    expect(limiter.getState('default')).toEqual({
      remaining: 0,
      queued: 2,
      resetAt: 1000
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(adapter.started).toEqual(['/one', '/two'])

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all(requests)
    expect(adapter.started).toEqual([
      '/one',
      '/two',
      '/three',
      '/four'
    ])
  })

  it('should isolate keys and support per-request disabling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const adapter = new RecordingAdapter()
    const client = createClient({ adapter }).use(rateLimitPlugin({
      maxRequests: 1,
      interval: 1000,
      createKey: () => 'shared'
    }))
    const queued = client.get('/queued')
    const waiting = client.get('/waiting')
    const custom = client.get('/custom', {
      extensions: {
        rateLimit: { key: 'custom' }
      }
    })
    const disabled = client.get('/disabled', {
      extensions: {
        rateLimit: { enabled: false }
      }
    })

    await flush()
    expect(adapter.started).toEqual([
      '/queued',
      '/custom',
      '/disabled'
    ])

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([queued, waiting, custom, disabled])
    expect(adapter.started.at(-1)).toBe('/waiting')
  })

  it('should reject queue overflow and expired waits', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const adapter = new RecordingAdapter()
    const client = createClient({ adapter }).use(rateLimitPlugin({
      maxRequests: 1,
      interval: 1000,
      maxQueue: 1,
      queueTimeout: 100
    }))
    const admitted = client.get('/admitted')
    const timedOut = client.get('/timed-out')
    const overflow = client.get('/overflow')
    const overflowRejection = expect(overflow).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      message: 'Rate limit queue is full'
    })
    const timeoutRejection = expect(timedOut).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      message: 'Rate limit queue wait timed out'
    })

    await flush()
    await vi.advanceTimersByTimeAsync(100)
    await Promise.all([
      admitted,
      overflowRejection,
      timeoutRejection
    ])
    expect(adapter.started).toEqual(['/admitted'])
  })

  it('should remove an aborted queued attempt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const adapter = new RecordingAdapter()
    const limiter = rateLimitPlugin({
      maxRequests: 1,
      interval: 1000
    })
    const client = createClient({ adapter }).use(limiter)
    const controller = new AbortController()
    const admitted = client.get('/admitted')
    const aborted = client.get('/aborted', {
      signal: controller.signal
    })
    const rejection = expect(aborted).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Request aborted while waiting for rate limit permit'
    })

    await flush()
    controller.abort('cancelled')
    await rejection
    await admitted
    expect(limiter.getState('default').queued).toBe(0)
    expect(adapter.started).toEqual(['/admitted'])
  })

  it('should reject queued attempts when removed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const adapter = new RecordingAdapter()
    const client = createClient({ adapter }).use(rateLimitPlugin({
      maxRequests: 1,
      interval: 1000
    }))
    const admitted = client.get('/admitted')
    const queued = client.get('/queued')
    const rejection = expect(queued).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Rate limit plugin removed while request was queued'
    })

    await flush()
    client.unuse('rate-limit')
    await Promise.all([admitted, rejection])
    expect(adapter.started).toEqual(['/admitted'])
  })

  it('should rate limit retry transport attempts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    let attempts = 0
    const adapter: Adapter = {
      request<T = unknown>(config: RequestConfig) {
        attempts += 1

        if (attempts === 1) {
          return Promise.reject(new RequestError('temporary failure', {
            code: 'NETWORK_ERROR',
            config
          }))
        }

        return Promise.resolve({
          data: 'recovered' as T,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config,
          raw: new Response()
        })
      }
    }
    const client = createClient({ adapter })
      .use(retryPlugin({ retries: 1, delay: 0 }))
      .use(rateLimitPlugin({ maxRequests: 1, interval: 1000 }))
    const result = client.get('/retry')

    await flush()
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toBe('recovered')
    expect(attempts).toBe(2)
  })
})

class RecordingAdapter implements Adapter {
  readonly started: string[] = []

  request<T = unknown>(
    config: RequestConfig
  ): Promise<NporaResponse<T>> {
    this.started.push(String(config.url))

    return Promise.resolve({
      data: undefined as T,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      config,
      raw: new Response()
    })
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
