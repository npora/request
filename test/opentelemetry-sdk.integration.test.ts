import { context, propagation, trace } from '@opentelemetry/api'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader
} from '@opentelemetry/sdk-metrics'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'
import {
  createClient,
  MockAdapter,
  openTelemetryMetricsPlugin,
  openTelemetryPlugin,
  retryPlugin,
  type OpenTelemetryMeter,
  type OpenTelemetryTracer
} from '../src'

describe('OpenTelemetry SDK integration', () => {
  it('should export real spans and stable metrics through the official SDK', async () => {
    const spanExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)]
    })
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE
    )
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000
    })
    const meterProvider = new MeterProvider({ readers: [metricReader] })
    const adapter = new MockAdapter()

    adapter.onGet('/health').reply(200, { ok: true })

    const client = createClient({
      adapter,
      baseURL: 'https://api.example.com'
    })
      .use(openTelemetryPlugin({
        tracer: tracerProvider.getTracer(
          '@npora/request-test'
        ) as unknown as OpenTelemetryTracer,
        context,
        trace,
        propagation
      }))
      .use(openTelemetryMetricsPlugin({
        meter: meterProvider.getMeter(
          '@npora/request-test'
        ) as unknown as OpenTelemetryMeter,
        semconv: 'both'
      }))

    try {
      await expect(client.get('/health')).resolves.toEqual({ ok: true })
      await Promise.all([
        tracerProvider.forceFlush(),
        meterProvider.forceFlush()
      ])

      const spans = spanExporter.getFinishedSpans()

      expect(spans).toHaveLength(1)
      expect(spans[0]).toMatchObject({
        name: 'GET',
        kind: 2,
        attributes: {
          'http.request.method': 'GET',
          'server.address': 'api.example.com',
          'http.response.status_code': 200
        }
      })

      const metricNames = metricExporter.getMetrics().flatMap(resource => (
        resource.scopeMetrics.flatMap(scope => (
          scope.metrics.map(metric => metric.descriptor.name)
        ))
      ))

      expect(metricNames).toContain('http.client.request.duration')
      expect(metricNames).toContain('npora.client.request.duration')
      expect(metricNames).toContain('npora.client.active_requests')
    } finally {
      await Promise.all([
        tracerProvider.shutdown(),
        meterProvider.shutdown()
      ])
    }
  })

  it('should export retry attempts with stable resend telemetry', async () => {
    const spanExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)]
    })
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE
    )
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000
    })
    const meterProvider = new MeterProvider({ readers: [metricReader] })
    const adapter = new MockAdapter()

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
      .use(openTelemetryPlugin({
        tracer: tracerProvider.getTracer(
          '@npora/request-test'
        ) as unknown as OpenTelemetryTracer,
        context,
        trace,
        propagation
      }))
      .use(openTelemetryMetricsPlugin({
        meter: meterProvider.getMeter(
          '@npora/request-test'
        ) as unknown as OpenTelemetryMeter,
        semconv: 'stable'
      }))

    try {
      await expect(client.get('/retry')).resolves.toEqual({ ok: true })
      await Promise.all([
        tracerProvider.forceFlush(),
        meterProvider.forceFlush()
      ])

      const spans = spanExporter.getFinishedSpans()

      expect(spans).toHaveLength(2)
      expect(spans[0]?.attributes).toMatchObject({
        'http.response.status_code': 503,
        'error.type': '503'
      })
      expect(spans[1]?.attributes).toMatchObject({
        'http.request.resend_count': 1,
        'http.response.status_code': 200
      })

      const duration = metricExporter.getMetrics().flatMap(resource => (
        resource.scopeMetrics.flatMap(scope => scope.metrics)
      )).find(metric => (
        metric.descriptor.name === 'http.client.request.duration'
      ))
      const attributes = duration?.dataPoints.map(point => (
        point.attributes
      ))

      expect(attributes).toHaveLength(2)
      expect(attributes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          'http.response.status_code': 503,
          'error.type': '503'
        }),
        expect.objectContaining({
          'http.response.status_code': 200
        })
      ]))
    } finally {
      await Promise.all([
        tracerProvider.shutdown(),
        meterProvider.shutdown()
      ])
    }
  })
})
