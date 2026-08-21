import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Adapter, NporaResponse, RequestConfig } from '../src'
import {
  concurrencyPlugin,
  createClient,
  retryPlugin
} from '../src'

afterEach(() => {
  vi.useRealTimers()
})

describe('concurrencyPlugin', () => {
  it('should limit active requests and admit queued requests in FIFO order', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1
    })
    const request = createClient({ adapter }).use(concurrency)

    const first = request.get('/first')
    const second = request.get('/second')
    const third = request.get('/third')

    await flush()

    expect(adapter.started).toEqual(['/first'])
    expect(concurrency.getState('default')).toEqual({
      active: 1,
      queued: 2
    })

    adapter.complete('/first')
    await first
    await flush()

    expect(adapter.started).toEqual(['/first', '/second'])

    adapter.complete('/second')
    await second
    await flush()

    expect(adapter.started).toEqual([
      '/first',
      '/second',
      '/third'
    ])

    adapter.complete('/third')
    await third

    expect(concurrency.getState('default')).toEqual({
      active: 0,
      queued: 0
    })
  })

  it('should isolate limits by resolved origin', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1
    })
    const request = createClient({ adapter }).use(concurrency)

    const first = request.get('https://first.example/one')
    const second = request.get('https://first.example/two')
    const other = request.get('https://other.example/one')

    await flush()

    expect(adapter.started).toEqual([
      'https://first.example/one',
      'https://other.example/one'
    ])
    expect(concurrency.getState('https://first.example')).toEqual({
      active: 1,
      queued: 1
    })
    expect(concurrency.getState('https://other.example')).toEqual({
      active: 1,
      queued: 0
    })

    adapter.complete('https://first.example/one')
    adapter.complete('https://other.example/one')
    await Promise.all([first, other])
    await flush()

    adapter.complete('https://first.example/two')
    await second
  })

  it('should support custom and disabled request isolation', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1,
      createKey: () => 'shared'
    })
    const request = createClient({ adapter }).use(concurrency)

    const first = request.get('/first')
    const custom = request.get('/custom', {
      extensions: {
        concurrency: {
          key: 'custom'
        }
      }
    })
    const disabled = request.get('/disabled', {
      extensions: {
        concurrency: {
          enabled: false
        }
      }
    })

    await flush()

    expect(adapter.started).toEqual([
      '/first',
      '/custom',
      '/disabled'
    ])

    adapter.complete('/first')
    adapter.complete('/custom')
    adapter.complete('/disabled')
    await Promise.all([first, custom, disabled])
  })

  it('should reject when the queue is full', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1,
      maxQueue: 1
    })
    const request = createClient({ adapter }).use(concurrency)
    const controller = new AbortController()

    controller.abort('already cancelled')

    const active = request.get('/active')
    const queued = request.get('/queued')
    const aborted = request.get('/aborted', {
      signal: controller.signal
    })
    const rejected = request.get('/rejected')

    const abortedRejection = expect(aborted).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
    const limitRejection = expect(rejected).rejects.toMatchObject({
      code: 'CONCURRENCY_LIMIT',
      message: 'Concurrency queue is full'
    })

    await Promise.all([abortedRejection, limitRejection])

    adapter.complete('/active')
    await active
    await flush()
    adapter.complete('/queued')
    await queued

    expect(adapter.started).not.toContain('/rejected')
    expect(adapter.started).not.toContain('/aborted')
  })

  it('should time out while waiting without consuming a permit', async () => {
    vi.useFakeTimers()

    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1,
      queueTimeout: 50
    })
    const request = createClient({ adapter }).use(concurrency)

    const active = request.get('/active')
    const queued = request.get('/queued')

    await flush()
    const rejection = expect(queued).rejects.toMatchObject({
      code: 'CONCURRENCY_LIMIT',
      message: 'Concurrency queue wait timed out'
    })
    await vi.advanceTimersByTimeAsync(50)

    await rejection
    expect(concurrency.getState('default')).toEqual({
      active: 1,
      queued: 0
    })

    adapter.complete('/active')
    await active
  })

  it('should cap queue waits at the platform timer limit', async () => {
    vi.useFakeTimers()

    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    const adapter = new ControlledAdapter()
    const request = createClient({ adapter }).use(
      concurrencyPlugin({
        maxConcurrent: 1,
        queueTimeout: Number.MAX_SAFE_INTEGER
      })
    )

    const active = request.get('/active')
    const queued = request.get('/queued')

    await flush()
    expect(timerSpy).toHaveBeenCalledWith(
      expect.any(Function),
      2_147_483_647
    )

    adapter.complete('/active')
    await active
    await flush()
    adapter.complete('/queued')
    await queued
  })

  it('should allow a request to override the queue timeout', async () => {
    vi.useFakeTimers()

    const adapter = new ControlledAdapter()
    const request = createClient({ adapter }).use(
      concurrencyPlugin({
        maxConcurrent: 1,
        queueTimeout: 1000
      })
    )

    const active = request.get('/active')
    const queued = request.get('/queued', {
      extensions: {
        concurrency: {
          queueTimeout: 10
        }
      }
    })

    await flush()
    const rejection = expect(queued).rejects.toMatchObject({
      code: 'CONCURRENCY_LIMIT'
    })
    await vi.advanceTimersByTimeAsync(10)

    await rejection

    adapter.complete('/active')
    await active
  })

  it('should remove and reject an aborted queued request', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1
    })
    const request = createClient({ adapter }).use(concurrency)
    const controller = new AbortController()

    const active = request.get('/active')
    const queued = request.get('/queued', {
      signal: controller.signal
    })

    await flush()
    controller.abort('cancel queued request')

    await expect(queued).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
    expect(concurrency.getState('default')).toEqual({
      active: 1,
      queued: 0
    })

    adapter.complete('/active')
    await active
  })

  it('should reject queued requests when the plugin is removed', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1
    })
    const request = createClient({ adapter }).use(concurrency)

    const active = request.get('/active')
    const queued = request.get('/queued')

    await flush()
    request.unuse('concurrency')

    await expect(queued).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Concurrency plugin removed while request was queued'
    })
    expect(concurrency.getState('default')).toEqual({
      active: 0,
      queued: 0
    })

    adapter.complete('/active')
    await active
  })

  it('should release a permit after a failed request settles', async () => {
    const adapter = new ControlledAdapter()
    const request = createClient({ adapter }).use(
      concurrencyPlugin({
        maxConcurrent: 1
      })
    )

    const active = request.get('/active')
    const queued = request.get('/queued')

    await flush()
    adapter.fail('/active')
    await expect(active).rejects.toThrow('adapter failure')
    await flush()

    expect(adapter.started).toEqual(['/active', '/queued'])

    adapter.complete('/queued')
    await queued
  })

  it('should hold one permit across the complete retry lifecycle', async () => {
    const adapter = new ControlledAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1
    })
    const request = createClient({ adapter })
      .use(concurrency)
      .use(retryPlugin({
        retries: 1,
        delay: 0,
        shouldRetry: () => true
      }))

    const retried = request.get('/retried')
    const queued = request.get('/queued')

    await flush()
    adapter.fail('/retried')
    await vi.waitFor(() => {
      expect(adapter.started).toHaveLength(2)
    })

    expect(adapter.started).toEqual(['/retried', '/retried'])
    expect(concurrency.getState('default')).toEqual({
      active: 1,
      queued: 1
    })

    adapter.complete('/retried')
    await retried
    await vi.waitFor(() => {
      expect(adapter.started).toHaveLength(3)
    })

    expect(adapter.started).toEqual([
      '/retried',
      '/retried',
      '/queued'
    ])

    adapter.complete('/queued')
    await queued
  })

  it('should remain bounded and reusable across high-cardinality keys', async () => {
    const adapter = new ImmediateAdapter()
    const concurrency = concurrencyPlugin({
      maxConcurrent: 1,
      maxKeys: 10
    })
    const request = createClient({ adapter }).use(concurrency)

    for (let index = 0; index < 2000; index += 1) {
      await request.get('/stress', {
        extensions: {
          concurrency: {
            key: String(index)
          }
        }
      })
    }

    await expect(request.get('/after-stress')).resolves.toEqual({
      ok: true
    })
    expect(adapter.calls).toBe(2001)
  })
})

class ControlledAdapter implements Adapter {
  readonly started: string[] = []

  private readonly pending = new Map<string, {
    resolve(response: NporaResponse): void
    reject(error: unknown): void
  }>()

  request(config: RequestConfig): Promise<NporaResponse> {
    this.started.push(config.url)

    return new Promise((resolve, reject) => {
      this.pending.set(config.url, {
        resolve,
        reject
      })
    })
  }

  complete(url: string): void {
    const pending = this.pending.get(url)

    if (!pending) {
      throw new Error(`Request was not active: ${url}`)
    }

    this.pending.delete(url)
    pending.resolve(createResponse(url))
  }

  fail(url: string): void {
    const pending = this.pending.get(url)

    if (!pending) {
      throw new Error(`Request was not active: ${url}`)
    }

    this.pending.delete(url)
    pending.reject(new Error('adapter failure'))
  }
}

class ImmediateAdapter implements Adapter {
  calls = 0

  async request(config: RequestConfig): Promise<NporaResponse> {
    this.calls += 1
    return createResponse(config.url)
  }
}

function createResponse(url: string): NporaResponse {
  const config = {
    url
  }

  return {
    data: {
      ok: true
    },
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config,
    raw: new Response()
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
