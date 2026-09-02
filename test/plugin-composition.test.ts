import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authPlugin,
  cachePlugin,
  circuitBreakerPlugin,
  concurrencyPlugin,
  createClient,
  MockAdapter,
  openTelemetryMetricsPlugin,
  rateLimitPlugin,
  retryPlugin,
  type OpenTelemetryMetricAttributes,
  type Plugin
} from '../src'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('plugin composition state matrix', () => {
  it('should bypass transport governance and HTTP metrics on a cache hit', async () => {
    const metrics = createMeter()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' }
    }))
    const transportAttempts: number[] = []
    const transportObserver: Plugin = {
      name: 'transport-observer',
      priority: -3000,
      install(context) {
        context.hooks.onTransport(request => {
          transportAttempts.push(request.attempt)
        })
      }
    }

    vi.stubGlobal('fetch', fetchMock)
    const concurrency = concurrencyPlugin({ maxConcurrent: 1 })
    const limiter = rateLimitPlugin({ maxRequests: 10, interval: 1000 })
    const circuit = circuitBreakerPlugin()
    const client = createClient({ baseURL: 'https://api.example.com' })
      .use(cachePlugin())
      .use(authPlugin({ token: 'token' }))
      .use(limiter)
      .use(concurrency)
      .use(retryPlugin({ retries: 1 }))
      .use(circuit)
      .use(openTelemetryMetricsPlugin({
        meter: metrics.meter,
        semconv: 'both'
      }))
      .use(transportObserver)
    const config = {
      extensions: { cache: { enabled: true, ttl: Infinity } }
    } as const

    await client.get('/resource', config)
    await client.get('/resource', config)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(transportAttempts).toEqual([0])
    expect(values(metrics, 'http.client.request.duration')).toHaveLength(1)
    expect(values(metrics, 'npora.client.request.duration')).toHaveLength(2)
    expect(concurrency.getState('https://api.example.com')).toEqual({
      active: 0,
      queued: 0
    })
    expect(limiter.getState('https://api.example.com').remaining).toBe(9)
    expect(circuit.getState('https://api.example.com')).toBe('closed')
  })

  it('should order auth refresh before a server-directed 429 retry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const authorizations: Array<string | null> = []
    const fetchMock = vi.fn(async (_input, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization'))
      const attempt = authorizations.length

      if (attempt === 1) return new Response('unauthorized', { status: 401 })
      if (attempt === 2) {
        return new Response('limited', {
          status: 429,
          headers: { 'retry-after': '1' }
        })
      }
      return new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' }
      })
    })
    let token = 'expired'
    const client = createClient({ fetch: fetchMock })
      .use(retryPlugin({ retries: 2, delay: 0 }))
      .use(authPlugin({
        token: () => token,
        refreshToken: () => {
          token = 'fresh'
          return token
        }
      }))
      .use(rateLimitPlugin({
        maxRequests: 100,
        interval: 1000,
        sharedRetryAfter: true
      }))
    const pending = client.get('/ordered')

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(authorizations).toEqual([
      'Bearer expired',
      'Bearer fresh',
      'Bearer fresh'
    ])
  })

  it('should exclude background stale refreshes from user metrics', async () => {
    vi.useFakeTimers()
    const metrics = createMeter()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"version":1}', {
        headers: {
          'cache-control': 'max-age=0, stale-while-revalidate=5',
          'content-type': 'application/json'
        }
      }))
      .mockResolvedValueOnce(new Response('{"version":2}', {
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'application/json'
        }
      }))

    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()
      .use(cachePlugin())
      .use(openTelemetryMetricsPlugin({
        meter: metrics.meter,
        semconv: 'both'
      }))
    const config = {
      extensions: { cache: { enabled: true, ttl: 10_000 } }
    } as const

    await client.get('/swr', config)
    await expect(client.get('/swr', config)).resolves.toEqual({ version: 1 })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(values(metrics, 'npora.client.request.duration')).toHaveLength(2)
    expect(values(metrics, 'http.client.request.duration')).toHaveLength(1)
  })

  it.each([
    ['retry delay', () => createClient({
      fetch: async () => new Response('busy', { status: 503 })
    }).use(retryPlugin({ retries: 1, delay: 1000 })).get('/retry', {
      totalTimeout: 25
    })],
    ['concurrency queue', () => {
      const concurrency = concurrencyPlugin({ maxConcurrent: 1, maxQueue: 1 })
      const client = createClient({
        fetch: () => new Promise<Response>(() => {})
      }).use(concurrency)

      void client.get('/active')
      return client.get('/queue', { totalTimeout: 25 })
    }]
  ])('should classify totalTimeout once during %s', async (_stage, run) => {
    vi.useFakeTimers()
    const pending = run()
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })

    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['Fetch', 'custom adapter'])(
    'should preserve retry attempt semantics with %s',
    async transport => {
      const attempts: number[] = []
      const observer: Plugin = {
        name: 'attempt-observer',
        install(context) {
          context.hooks.onTransport(request => attempts.push(request.attempt))
        }
      }
      const adapter = new MockAdapter()

      adapter
        .onGet('/attempts')
        .replyOnce(503, { busy: true })
        .onGet('/attempts')
        .reply(200, { ok: true })
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response('busy', { status: 503 }))
        .mockResolvedValueOnce(new Response('{"ok":true}', {
          headers: { 'content-type': 'application/json' }
        }))
      const client = createClient(
        transport === 'Fetch' ? { fetch } : { adapter }
      )
        .use(retryPlugin({ retries: 1, delay: 0 }))
        .use(observer)

      await expect(client.get('/attempts')).resolves.toEqual({ ok: true })
      expect(attempts).toEqual([0, 1])
    }
  )
})

interface MetricRecord {
  value: number
  attributes?: OpenTelemetryMetricAttributes
}

function createMeter() {
  const records: Record<string, MetricRecord[]> = {}
  const instrument = (name: string) => ({
    add(value: number, attributes?: OpenTelemetryMetricAttributes) {
      ;(records[name] ??= []).push({ value, attributes })
    },
    record(value: number, attributes?: OpenTelemetryMetricAttributes) {
      ;(records[name] ??= []).push({ value, attributes })
    }
  })

  return {
    records,
    meter: {
      createCounter: (name: string) => instrument(name),
      createUpDownCounter: (name: string) => instrument(name),
      createHistogram: (name: string) => instrument(name)
    }
  }
}

function values(metrics: ReturnType<typeof createMeter>, name: string) {
  return metrics.records[name]?.map(record => record.value) ?? []
}
