import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cachePlugin,
  createClient,
  MockAdapter,
  openTelemetryMetricsPlugin,
  rateLimitPlugin,
  retryPlugin,
  type OpenTelemetryMetricAttributes,
  type OpenTelemetryMetricsPluginOptions,
  type Plugin
} from '../src'

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenTelemetry metrics plugin', () => {
  it('should record duration, active requests, retries, cache, and rate waits', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const telemetry = createMeter()
    const adapter = new MockAdapter()

    adapter
      .onGet('/retry')
      .replyOnce(503, { busy: true })
      .onGet('/retry')
      .reply(200, { ok: true })
      .onGet('/cached')
      .reply(200, { cached: true })

    const client = createClient({ adapter })
      .use(retryPlugin({ retries: 1, delay: 0 }))
      .use(rateLimitPlugin({ maxRequests: 1, interval: 10 }))
      .use(cachePlugin())
      .use(openTelemetryMetricsPlugin({
        meter: telemetry.meter,
        attributes: { 'service.name': 'checkout' }
      }))

    const retry = client.get('/retry')

    await vi.advanceTimersByTimeAsync(10)
    await expect(retry).resolves.toEqual({ ok: true })

    const cacheConfig = {
      extensions: { cache: { enabled: true, ttl: Infinity } }
    } as const
    const firstCache = client.get('/cached', cacheConfig)

    await vi.advanceTimersByTimeAsync(10)
    await firstCache
    await client.get('/cached', cacheConfig)

    expect(values(telemetry, 'npora.client.active_requests')).toEqual([
      1, -1, 1, -1, 1, -1
    ])
    expect(values(telemetry, 'npora.client.retry.attempts')).toEqual([1])
    expect(values(telemetry, 'npora.client.rate_limit.wait.duration'))
      .toEqual([10, 10])
    expect(
      telemetry.records['npora.client.cache.requests']?.map(
        record => record.attributes?.['cache.result']
      )
    ).toEqual(['miss', 'hit'])
    expect(telemetry.records['npora.client.request.duration']).toHaveLength(3)
    expect(
      telemetry.records['npora.client.request.duration']?.[0]?.attributes
    ).toMatchObject({
      'service.name': 'checkout',
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'request.outcome': 'success'
    })
  })

  it('should isolate meter failures and support per-request filtering', async () => {
    const telemetry = createMeter()
    telemetry.meter.createHistogram = vi.fn(() => {
      throw new Error('exporter unavailable')
    })
    const adapter = new MockAdapter()

    adapter
      .onGet('/measured')
      .reply(200, { ok: true })
      .onGet('/ignored')
      .reply(200, { ok: true })

    const client = createClient({ adapter }).use(
      openTelemetryMetricsPlugin({
        meter: telemetry.meter,
        shouldRecord: config => config.url !== '/ignored'
      })
    )

    await expect(client.get('/measured', {
      extensions: {
        openTelemetryMetrics: {
          attributes: { 'app.operation': 'measured' }
        }
      }
    })).resolves.toEqual({ ok: true })
    await expect(client.get('/ignored')).resolves.toEqual({ ok: true })

    expect(values(telemetry, 'npora.client.active_requests')).toEqual([1, -1])
  })

  it('should measure request-hook failures and only count dispatched retries', async () => {
    vi.useFakeTimers()
    const telemetry = createMeter()
    const adapter = new MockAdapter()
    const controller = new AbortController()

    adapter.onGet('/retry-abort').reply(503, { busy: true })

    const failingPlugin: Plugin = {
      name: 'failing-request-hook',
      install(context) {
        context.hooks.onRequest(() => {
          throw new Error('request hook failed')
        })
      }
    }
    const failedClient = createClient({ adapter })
      .use(failingPlugin)
      .use(openTelemetryMetricsPlugin({ meter: telemetry.meter }))

    await expect(failedClient.get('/hook-failure')).rejects.toThrow(
      'request hook failed'
    )

    const retryClient = createClient({ adapter })
      .use(retryPlugin({ retries: 1, delay: 1000 }))
      .use(openTelemetryMetricsPlugin({ meter: telemetry.meter }))
    const pending = retryClient.get('/retry-abort', {
      signal: controller.signal
    })

    await vi.advanceTimersByTimeAsync(0)
    controller.abort('cancel retry wait')
    await expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })

    expect(values(telemetry, 'npora.client.retry.attempts')).toEqual([])
    expect(
      telemetry.records['npora.client.request.duration']?.map(
        record => record.attributes?.['request.outcome']
      )
    ).toEqual(['error', 'error'])
  })

  it('should not report another plugin short circuit as a cache hit', async () => {
    const telemetry = createMeter()
    const shortCircuit: Plugin = {
      name: 'short-circuit',
      install(context) {
        context.hooks.onRequest(requestContext => {
          const raw = new Response('{"source":"plugin"}', {
            headers: { 'content-type': 'application/json' }
          })

          requestContext.response = {
            data: { source: 'plugin' },
            status: 200,
            statusText: '',
            headers: raw.headers,
            config: requestContext.config,
            raw
          }
        })
      }
    }
    const client = createClient({ adapter: new MockAdapter() })
      .use(cachePlugin())
      .use(shortCircuit)
      .use(openTelemetryMetricsPlugin({ meter: telemetry.meter }))

    await expect(client.get('/short-circuit', {
      extensions: { cache: { enabled: true } }
    })).resolves.toEqual({ source: 'plugin' })

    expect(
      telemetry.records['npora.client.cache.requests']?.[0]
        ?.attributes?.['cache.result']
    ).toBe('miss')
  })

  it('should measure complete and cancelled stream consumption', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const telemetry = createMeter()
    let byteStreamCancelled = false
    const encoder = new TextEncoder()
    const client = createClient({
      fetch: async input => {
        if (String(input).endsWith('/records')) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode('{"id":1}\n{"id":2}\n'))
                controller.close()
              }
            }),
            { headers: { 'content-type': 'application/x-ndjson' } }
          )
        }

        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(encoder.encode('chunk'))
          },
          cancel() {
            byteStreamCancelled = true
          }
        }))
      }
    }).use(openTelemetryMetricsPlugin({ meter: telemetry.meter }))

    const records = await client.ndjson<{ id: number }>('/records')

    expect(values(telemetry, 'npora.client.active_streams')).toEqual([1])
    vi.setSystemTime(25)
    const collected: Array<{ id: number }> = []

    for await (const record of records) {
      collected.push(record)
    }

    expect(collected).toEqual([{ id: 1 }, { id: 2 }])

    const bytes = await client.get<ReadableStream<Uint8Array>>('/bytes', {
      responseType: 'stream'
    })

    vi.setSystemTime(40)
    await bytes.cancel('consumer stopped')

    expect(byteStreamCancelled).toBe(true)
    expect(values(telemetry, 'npora.client.active_streams')).toEqual([
      1, -1, 1, -1
    ])
    expect(
      telemetry.records['npora.client.active_streams']?.every(
        record => record.attributes?.['stream.outcome'] === undefined
      )
    ).toBe(true)
    expect(values(telemetry, 'npora.client.stream.duration')).toEqual([
      25, 15
    ])
    expect(
      telemetry.records['npora.client.stream.duration']?.map(record => ({
        type: record.attributes?.['stream.type'],
        outcome: record.attributes?.['stream.outcome']
      }))
    ).toEqual([
      { type: 'ndjson', outcome: 'complete' },
      { type: 'bytes', outcome: 'cancelled' }
    ])
  })

  it('should allow stream consumption metrics to be disabled per request', async () => {
    const telemetry = createMeter()
    const client = createClient({
      fetch: async () => new Response('{"id":1}\n', {
        headers: { 'content-type': 'application/x-ndjson' }
      })
    }).use(openTelemetryMetricsPlugin({ meter: telemetry.meter }))
    const records = await client.ndjson('/records', {
      extensions: {
        openTelemetryMetrics: {
          measureStreamConsumption: false
        }
      }
    })

    for await (const _ of records) {
      // Consume the uninstrumented stream.
    }

    expect(values(telemetry, 'npora.client.active_streams')).toEqual([])
    expect(values(telemetry, 'npora.client.stream.duration')).toEqual([])
  })

  it('should classify stream errors and balance active streams on removal', async () => {
    const telemetry = createMeter()
    const plugin = openTelemetryMetricsPlugin({ meter: telemetry.meter })
    const client = createClient({
      fetch: async input => String(input).endsWith('/invalid')
        ? new Response('not-json\n', {
            headers: { 'content-type': 'application/x-ndjson' }
          })
        : new Response(new ReadableStream<Uint8Array>({
            pull() {
              // Keep the stream open until the consumer or plugin stops it.
            }
          }))
    }).use(plugin)
    const invalid = await client.ndjson('/invalid')
    const consumeInvalid = async () => {
      for await (const _ of invalid) {
        // Parsing fails before an item is emitted.
      }
    }

    await expect(consumeInvalid()).rejects.toMatchObject({
      code: 'PARSER_ERROR'
    })

    const pending = await client.get<ReadableStream<Uint8Array>>('/pending', {
      responseType: 'stream'
    })

    client.unuse('opentelemetry-metrics')

    expect(
      telemetry.records['npora.client.stream.duration']?.map(
        record => record.attributes?.['stream.outcome']
      )
    ).toEqual(['error', 'instrumentation_removed'])
    expect(values(telemetry, 'npora.client.active_streams')).toEqual([
      1, -1, 1, -1
    ])

    await pending.cancel()
    expect(values(telemetry, 'npora.client.stream.duration')).toHaveLength(2)
  })

  it('should emit stable HTTP duration per transport attempt in seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const telemetry = createMeter()
    const adapter = new MockAdapter({ delay: 100 })

    adapter
      .onGet('/retry')
      .replyOnce(503, { busy: true })
      .onGet('/retry')
      .reply(200, { ok: true })

    const client = createClient({
      adapter,
      baseURL: 'https://api.example.com'
    })
      .use(retryPlugin({ retries: 1, delay: 0 }))
      .use(openTelemetryMetricsPlugin({
        meter: telemetry.meter,
        semconv: 'stable'
      }))
    const pending = client.get('/retry')

    await vi.advanceTimersByTimeAsync(200)
    await expect(pending).resolves.toEqual({ ok: true })

    expect(values(telemetry, 'http.client.request.duration')).toEqual([
      0.1, 0.1
    ])
    expect(
      telemetry.records['http.client.request.duration']?.map(record => (
        record.attributes
      ))
    ).toEqual([
      expect.objectContaining({
        'http.request.method': 'GET',
        'server.address': 'api.example.com',
        'http.response.status_code': 503,
        'error.type': '503'
      }),
      expect.objectContaining({
        'http.request.method': 'GET',
        'http.response.status_code': 200
      })
    ])
    expect(telemetry.records['npora.client.request.duration']).toBeUndefined()
  })

  it('should emit both conventions and skip stable metrics for cache hits', async () => {
    const telemetry = createMeter()
    const adapter = new MockAdapter()

    adapter.onGet('/cached').reply(200, { ok: true })
    const client = createClient({ adapter })
      .use(cachePlugin())
      .use(openTelemetryMetricsPlugin({
        meter: telemetry.meter,
        semconv: 'both'
      }))
    const config = {
      extensions: { cache: { enabled: true, ttl: Infinity } }
    } as const

    await client.get('/cached', config)
    await client.get('/cached', config)

    expect(values(telemetry, 'http.client.request.duration')).toHaveLength(1)
    expect(values(telemetry, 'npora.client.request.duration')).toHaveLength(2)
    expect(values(telemetry, 'npora.client.cache.requests')).toHaveLength(2)
  })

  it('should reject a missing meter API', () => {
    expect(() => openTelemetryMetricsPlugin({
      meter: {}
    } as OpenTelemetryMetricsPluginOptions)).toThrow(TypeError)
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
      createCounter: vi.fn((name: string) => instrument(name)),
      createUpDownCounter: vi.fn((name: string) => instrument(name)),
      createHistogram: vi.fn((name: string) => instrument(name))
    }
  }
}

function values(
  telemetry: ReturnType<typeof createMeter>,
  name: string
): number[] {
  return telemetry.records[name]?.map(record => record.value) ?? []
}
