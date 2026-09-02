import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authPlugin,
  cachePlugin,
  circuitBreakerPlugin,
  concurrencyPlugin,
  createClient,
  MockAdapter,
  openTelemetryMetricsPlugin,
  openTelemetryPlugin,
  rateLimitPlugin,
  retryPlugin,
  type OpenTelemetryAttributeValue,
  type OpenTelemetryMetricAttributes,
  type OpenTelemetryPluginOptions,
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
    }],
    ['rate-limit queue', () => {
      const limiter = rateLimitPlugin({
        maxRequests: 1,
        interval: 1000,
        maxQueue: 1
      })
      const client = createClient({
        fetch: async () => new Response('{"ok":true}', {
          headers: { 'content-type': 'application/json' }
        })
      }).use(limiter)

      void client.get('/admitted')
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

  it('should jointly clean plugin-owned state when plugins are removed', async () => {
    const metrics = createMeter()
    const tracing = createTracing()
    const cache = cachePlugin()
    const concurrency = concurrencyPlugin({ maxConcurrent: 1, maxQueue: 1 })
    let resolveActive!: (response: Response) => void
    let streamCancelled = false
    const fetch = vi.fn(async input => {
      const url = String(input)

      if (url.endsWith('/stream')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
          },
          cancel() {
            streamCancelled = true
          }
        }))
      }

      if (url.endsWith('/active')) {
        return new Promise<Response>(resolve => {
          resolveActive = resolve
        })
      }

      return new Response('{"queued":true}', {
        headers: { 'content-type': 'application/json' }
      })
    })
    const client = createClient({ fetch })
      .use(cache)
      .use(concurrency)
      .use(openTelemetryPlugin(tracing.options))
      .use(openTelemetryMetricsPlugin({ meter: metrics.meter }))
    const stream = await client.get<ReadableStream<Uint8Array>>('/stream', {
      responseType: 'stream'
    })
    const reader = stream.getReader()

    await reader.read()

    const cachedConfig = {
      extensions: { cache: { enabled: true } }
    } as const
    const active = client.get('/active', cachedConfig)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const follower = client.get('/active', cachedConfig)
    const queued = client.get('/queued')

    await vi.waitFor(() => {
      expect(concurrency.getState('default').queued).toBe(1)
    })

    client.unuse('cache')
    client.unuse('concurrency')
    client.unuse('opentelemetry')
    client.unuse('opentelemetry-metrics')

    await expect(follower).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Cache plugin removed during shared request'
    })
    await expect(queued).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Concurrency plugin removed while request was queued'
    })
    expect(concurrency.getState('default')).toEqual({ active: 0, queued: 0 })
    const activeRequests = values(metrics, 'npora.client.active_requests')
    const activeStreams = values(metrics, 'npora.client.active_streams')

    expect(activeRequests).toHaveLength(8)
    expect(sum(activeRequests)).toBe(0)
    expect(activeStreams).toEqual([1, -1])
    expect(
      metrics.records['npora.client.stream.duration']?.map(record => (
        record.attributes?.['stream.outcome']
      ))
    ).toEqual(['instrumentation_removed'])
    expect(tracing.spans).toHaveLength(2)
    expect(tracing.spans[1]?.attributes).toMatchObject({
      'npora.request.instrumentation_removed': true
    })
    expect(tracing.spans[1]?.end).toHaveBeenCalledOnce()

    resolveActive(new Response('{"active":true}', {
      headers: { 'content-type': 'application/json' }
    }))
    await expect(active).resolves.toEqual({ active: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    await reader.cancel()
    expect(streamCancelled).toBe(true)
    expect(tracing.spans[1]?.end).toHaveBeenCalledOnce()
    expect(values(metrics, 'npora.client.stream.duration')).toHaveLength(1)
  })
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

function sum(input: readonly number[]): number {
  return input.reduce((total, value) => total + value, 0)
}

function createTracing() {
  const spans: Array<{
    attributes: Record<string, OpenTelemetryAttributeValue>
    end: ReturnType<typeof vi.fn>
  }> = []
  const options: OpenTelemetryPluginOptions = {
    tracer: {
      startSpan() {
        const span = {
          attributes: {} as Record<string, OpenTelemetryAttributeValue>,
          setAttribute(name: string, value: OpenTelemetryAttributeValue) {
            span.attributes[name] = value
            return span
          },
          setStatus() {
            return span
          },
          recordException() {},
          end: vi.fn()
        }

        spans.push(span)
        return span
      }
    },
    context: {
      active() {}
    },
    trace: {
      setSpan(context) {
        return context
      }
    },
    propagation: {
      inject() {}
    }
  }

  return { options, spans }
}
