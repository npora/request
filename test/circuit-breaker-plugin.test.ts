import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  circuitBreakerPlugin,
  createClient,
  MockAdapter,
  retryPlugin
} from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('circuitBreakerPlugin', () => {
  it('should evict the least recently used inactive circuit at capacity', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      maxCircuits: 2
    })
    const request = createClient({ adapter }).use(breaker)
    const withKey = (key: string) => ({
      extensions: {
        circuitBreaker: {
          key
        }
      }
    })

    adapter
      .onGet('/first')
      .reply(503)
      .onGet('/second')
      .reply(503)
      .onGet('/third')
      .reply(503)

    await expect(request.get('/first', withKey('first'))).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await expect(request.get('/second', withKey('second'))).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await expect(request.get('/first', withKey('first'))).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })
    await expect(request.get('/third', withKey('third'))).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    expect(breaker.getState('first')).toBe('open')
    expect(breaker.getState('second')).toBe('closed')
    expect(breaker.getState('third')).toBe('open')
    expect(adapter.history).toHaveLength(3)
  })

  it('should not rewrite LRU order for consecutive requests to one key', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin()
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/stable').reply(200, { ok: true })

    await request.get('/stable')

    const deleteSpy = vi.spyOn(Map.prototype, 'delete')
    const setSpy = vi.spyOn(Map.prototype, 'set')

    await request.get('/stable')

    const defaultDeletes = deleteSpy.mock.calls.filter(([key]) => {
      return key === 'default'
    }).length
    const defaultSets = setSpy.mock.calls.filter(([key]) => {
      return key === 'default'
    }).length

    deleteSpy.mockRestore()
    setSpy.mockRestore()

    expect(defaultDeletes).toBe(0)
    expect(defaultSets).toBe(0)
  })

  it('should retain active circuits while trimming settled states', async () => {
    vi.useFakeTimers()

    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      maxCircuits: 1
    })
    const request = createClient({ adapter }).use(breaker)
    const withKey = (key: string) => ({
      extensions: {
        circuitBreaker: {
          key
        }
      }
    })

    adapter
      .onGet('/active')
      .reply(503, undefined, { delay: 100 })
      .onGet('/settled')
      .reply(503)

    const activeRequest = expect(
      request.get('/active', withKey('active'))
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    await vi.waitFor(() => {
      expect(adapter.history).toHaveLength(1)
    })
    await expect(
      request.get('/settled', withKey('settled'))
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    expect(breaker.getState('settled')).toBe('closed')

    await vi.advanceTimersByTimeAsync(100)
    await activeRequest
    expect(breaker.getState('active')).toBe('open')
  })

  it('should open after consecutive final failures and reject without I/O', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 2
    })
    const request = createClient({
      adapter,
      baseURL: 'https://api.example.com'
    }).use(breaker)

    adapter.onGet('/unstable').reply(503, {
      message: 'busy'
    })

    await expect(request.get('/unstable')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    })
    expect(breaker.getState('https://api.example.com')).toBe('closed')

    await expect(request.get('/unstable')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    })
    expect(breaker.getState('https://api.example.com')).toBe('open')

    await expect(request.get('/unstable')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })
    expect(adapter.history).toHaveLength(2)
  })

  it('should reset consecutive failures after a successful request', async () => {
    let status = 503
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 2
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/flaky').reply(() => ({
      status,
      data: {
        status
      }
    }))

    await expect(request.get('/flaky')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    status = 200
    await expect(request.get('/flaky')).resolves.toEqual({
      status: 200
    })

    status = 503
    await expect(request.get('/flaky')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    expect(breaker.getState('default')).toBe('closed')
    expect(adapter.history).toHaveLength(3)
  })

  it('should probe after the reset window and close on recovery', async () => {
    vi.useFakeTimers()

    let healthy = false
    const events: string[] = []
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 100,
      onStateChange(event) {
        events.push(`${event.previousState}:${event.state}`)
      }
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/health').reply(() => ({
      status: healthy ? 200 : 503,
      data: {
        healthy
      }
    }))

    await expect(request.get('/health')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await expect(request.get('/health')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })

    healthy = true
    await vi.advanceTimersByTimeAsync(100)

    await expect(request.get('/health')).resolves.toEqual({
      healthy: true
    })
    expect(breaker.getState('default')).toBe('closed')
    expect(events).toEqual([
      'closed:open',
      'open:half-open',
      'half-open:closed'
    ])
  })

  it('should limit concurrent half-open probes', async () => {
    vi.useFakeTimers()

    let attempt = 0
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 50,
      halfOpenMaxRequests: 1
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/probe').reply(() => {
      attempt += 1

      return attempt === 1
        ? {
            status: 503
          }
        : {
            status: 200,
            data: {
              ok: true
            },
            delay: 100
          }
    })

    await expect(request.get('/probe')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await vi.advanceTimersByTimeAsync(50)

    const probe = request.get('/probe')

    await expect(request.get('/probe')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })
    expect(adapter.history).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(100)
    await expect(probe).resolves.toEqual({
      ok: true
    })
    expect(breaker.getState('default')).toBe('closed')
  })

  it('should retain a half-open probe slot during async failure classification', async () => {
    let classifyProbe!: (counted: boolean) => void
    let classifications = 0
    const probeDecision = new Promise<boolean>(resolve => {
      classifyProbe = resolve
    })
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 0,
      halfOpenMaxRequests: 1,
      shouldCountFailure() {
        classifications += 1
        return classifications === 1 ? true : probeDecision
      }
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/slow-policy').reply(503)

    await expect(request.get('/slow-policy')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    const probe = request.get('/slow-policy')

    await vi.waitFor(() => {
      expect(adapter.history).toHaveLength(2)
      expect(classifications).toBe(2)
    })

    const blocked = request.get('/slow-policy')

    classifyProbe(true)

    await expect(probe).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await expect(blocked).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })
    expect(adapter.history).toHaveLength(2)
    expect(classifications).toBe(2)
  })

  it('should release a half-open probe when its async classification is cancelled', async () => {
    let classifications = 0
    let attempts = 0
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 0,
      halfOpenMaxRequests: 1,
      shouldCountFailure() {
        classifications += 1
        return classifications === 1
          ? true
          : new Promise<boolean>(() => {})
      }
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/cancelled-policy').reply(() => {
      attempts += 1
      return attempts < 3
        ? { status: 503 }
        : { status: 200, data: { recovered: true } }
    })

    await expect(request.get('/cancelled-policy')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    const controller = new AbortController()
    const probe = request.get('/cancelled-policy', {
      signal: controller.signal
    })

    await vi.waitFor(() => {
      expect(classifications).toBe(2)
    })

    controller.abort('cancel failure classification')

    await expect(probe).rejects.toMatchObject({ code: 'HTTP_ERROR' })
    expect(breaker.getState('default')).toBe('half-open')
    await expect(request.get('/cancelled-policy')).resolves.toEqual({
      recovered: true
    })
    expect(breaker.getState('default')).toBe('closed')
    expect(adapter.history).toHaveLength(3)
  })

  it('should release a probe after an async uncounted failure', async () => {
    let classifyProbe!: (counted: boolean) => void
    let classifications = 0
    let attempts = 0
    const probeDecision = new Promise<boolean>(resolve => {
      classifyProbe = resolve
    })
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 0,
      halfOpenMaxRequests: 1,
      shouldCountFailure() {
        classifications += 1
        return classifications === 1 ? true : probeDecision
      }
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/uncounted-probe').reply(() => {
      attempts += 1
      return attempts < 3
        ? { status: 503 }
        : { status: 200, data: { recovered: true } }
    })

    await expect(request.get('/uncounted-probe')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    const probe = request.get('/uncounted-probe')

    await vi.waitFor(() => {
      expect(classifications).toBe(2)
    })

    await expect(request.get('/uncounted-probe')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })

    classifyProbe(false)
    await expect(probe).rejects.toMatchObject({ code: 'HTTP_ERROR' })
    expect(breaker.getState('default')).toBe('half-open')

    await expect(request.get('/uncounted-probe')).resolves.toEqual({
      recovered: true
    })
    expect(breaker.getState('default')).toBe('closed')
    expect(adapter.history).toHaveLength(3)
  })

  it('should release a probe when async failure classification rejects', async () => {
    let classifications = 0
    let attempts = 0
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 0,
      shouldCountFailure() {
        classifications += 1
        return classifications === 1
          ? true
          : Promise.reject(new Error('classification failed'))
      }
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/rejected-policy').reply(() => {
      attempts += 1
      return attempts < 3
        ? { status: 503 }
        : { status: 200, data: { recovered: true } }
    })

    await expect(request.get('/rejected-policy')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await expect(request.get('/rejected-policy')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    expect(breaker.getState('default')).toBe('half-open')
    await expect(request.get('/rejected-policy')).resolves.toEqual({
      recovered: true
    })
    expect(breaker.getState('default')).toBe('closed')
    expect(adapter.history).toHaveLength(3)
  })

  it('should reopen when a half-open probe fails', async () => {
    vi.useFakeTimers()

    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      resetTimeout: 100
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/down').reply(503)

    await expect(request.get('/down')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(request.get('/down')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    expect(breaker.getState('default')).toBe('open')

    await vi.advanceTimersByTimeAsync(99)
    await expect(request.get('/down')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN'
    })
  })

  it('should isolate custom keys and allow request-level opt out', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1
    })
    const request = createClient({ adapter }).use(breaker)

    adapter
      .onGet('/first')
      .reply(503)
      .onGet('/second')
      .reply(200, { ok: true })

    await expect(
      request.get('/first', {
        extensions: {
          circuitBreaker: {
            key: 'first-service'
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    await expect(
      request.get('/second', {
        extensions: {
          circuitBreaker: {
            key: 'second-service'
          }
        }
      })
    ).resolves.toEqual({
      ok: true
    })

    await expect(
      request.get('/first', {
        extensions: {
          circuitBreaker: {
            enabled: false,
            key: 'first-service'
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })

    expect(breaker.getState('first-service')).toBe('open')
    expect(breaker.getState('second-service')).toBe('closed')
    expect(adapter.history).toHaveLength(3)
  })

  it('should count one failure after retries are exhausted', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 2
    })
    const request = createClient({ adapter })
      .use(retryPlugin({
        retries: 1,
        delay: 0
      }))
      .use(breaker)

    adapter.onGet('/retry').reply(503)

    await expect(request.get('/retry')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    expect(adapter.history).toHaveLength(2)
    expect(breaker.getState('default')).toBe('closed')

    await expect(request.get('/retry')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    expect(adapter.history).toHaveLength(4)
    expect(breaker.getState('default')).toBe('open')
  })

  it('should ignore ordinary 4xx responses but count 429', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1
    })
    const request = createClient({ adapter }).use(breaker)

    adapter
      .onGet('/missing')
      .reply(404)
      .onGet('/limited')
      .reply(429)

    await expect(request.get('/missing')).rejects.toMatchObject({
      status: 404
    })
    expect(breaker.getState('default')).toBe('closed')

    await expect(request.get('/limited')).rejects.toMatchObject({
      status: 429
    })
    expect(breaker.getState('default')).toBe('open')
  })

  it('should support custom failure policies and manual reset', async () => {
    const onStateChange = vi.fn(() => {
      throw new Error('observer failed')
    })
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      shouldCountFailure: async error => {
        return error instanceof Error && error.message.includes('teapot')
      },
      onStateChange
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/teapot').reply(418, undefined, {
      statusText: 'teapot'
    })

    await expect(request.get('/teapot')).rejects.toMatchObject({
      status: 418
    })
    expect(breaker.getState('default')).toBe('open')
    expect(onStateChange).toHaveBeenCalledTimes(1)

    breaker.reset('default')
    expect(breaker.getState('default')).toBe('closed')

    await expect(request.get('/teapot')).rejects.toMatchObject({
      status: 418
    })

    breaker.reset()
    expect(breaker.getState('default')).toBe('closed')
  })

  it('should clear circuit state when the plugin is removed', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/down').reply(503)

    await expect(request.get('/down')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    expect(breaker.getState('default')).toBe('open')

    request.unuse('circuit-breaker')

    expect(breaker.getState('default')).toBe('closed')
    await expect(request.get('/down')).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    })
    expect(adapter.history).toHaveLength(2)
  })
})
