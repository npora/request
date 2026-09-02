import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cachePlugin,
  createClient,
  MockAdapter,
  openTelemetryPlugin,
  retryPlugin,
  type OpenTelemetryAttributeValue,
  type OpenTelemetryPluginOptions,
  type OpenTelemetrySpan
} from '../src'

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenTelemetry plugin', () => {
  it('should create a client span and inject sanitized trace context', async () => {
    const telemetry = createTelemetry()
    const adapter = new MockAdapter()
    const request = createClient({ adapter }).use(
      openTelemetryPlugin({
        ...telemetry.api,
        attributes: {
          'service.namespace': 'checkout'
        }
      })
    )

    adapter.onGet('https://user:secret@example.com/users?token=secret')
      .reply(200, { ok: true })

    await expect(request.get(
      'https://user:secret@example.com/users?token=secret',
      {
        extensions: {
          openTelemetry: {
            attributes: {
              'app.operation': 'list-users'
            }
          }
        }
      }
    )).resolves.toEqual({ ok: true })

    expect(telemetry.spans).toHaveLength(1)
    expect(telemetry.spans[0]?.name).toBe('GET')
    expect(telemetry.spans[0]?.options).toMatchObject({
      kind: 2,
      attributes: {
        'http.request.method': 'GET',
        'server.address': 'example.com',
        'server.port': 443,
        'url.scheme': 'https',
        'url.full': 'https://example.com/users',
        'service.namespace': 'checkout',
        'app.operation': 'list-users'
      }
    })
    expect(
      new Headers(adapter.history[0]?.headers).get('traceparent')
    ).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    )
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'http.response.status_code': 200
    })
    expect(telemetry.spans[0]?.end).toHaveBeenCalledOnce()
  })

  it('should trace every retry attempt with resend attributes', async () => {
    const telemetry = createTelemetry()
    const adapter = new MockAdapter()

    adapter
      .onGet('/retry')
      .replyOnce(503, { message: 'busy' })
      .onGet('/retry')
      .reply(200, { ok: true })

    const request = createClient({ adapter })
      .use(retryPlugin({ retries: 1, delay: 0 }))
      .use(openTelemetryPlugin(telemetry.api))

    await expect(request.get('/retry')).resolves.toEqual({ ok: true })

    expect(telemetry.spans).toHaveLength(2)
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'http.response.status_code': 503,
      'error.type': '503'
    })
    expect(telemetry.spans[0]?.statuses).toContainEqual({ code: 2 })
    expect(telemetry.spans[1]?.options.attributes).toMatchObject({
      'http.request.resend_count': 1
    })
    expect(telemetry.spans[1]?.attributes).toMatchObject({
      'http.response.status_code': 200
    })
    expect(telemetry.spans.every(span => (
      span.end.mock.calls.length === 1
    ))).toBe(true)
  })

  it('should leave cancelled spans unset and omit exceptions by default', async () => {
    vi.useFakeTimers()
    const telemetry = createTelemetry()
    const adapter = new MockAdapter({ delay: 1000 })
    const request = createClient({ adapter }).use(
      openTelemetryPlugin(telemetry.api)
    )
    const controller = new AbortController()

    adapter.onGet('/abort').reply(200, { ok: true })

    const pending = request.get('/abort', { signal: controller.signal })

    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })

    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'npora.request.cancelled': true
    })
    expect(telemetry.spans[0]?.statuses).toContainEqual({ code: 0 })
    expect(telemetry.spans[0]?.recordException).not.toHaveBeenCalled()
    expect(telemetry.spans[0]?.end).toHaveBeenCalledOnce()
  })

  it('should support per-request propagation disable and custom span names', async () => {
    const telemetry = createTelemetry()
    const adapter = new MockAdapter()
    const request = createClient({ adapter }).use(
      openTelemetryPlugin(telemetry.api)
    )

    adapter.onGet('/health').reply(204)

    await request.get('/health', {
      extensions: {
        openTelemetry: {
          propagate: false,
          spanName: 'GET health'
        }
      }
    })

    expect(telemetry.spans[0]?.name).toBe('GET health')
    expect(new Headers(adapter.history[0]?.headers).has('traceparent')).toBe(
      false
    )
  })

  it('should skip spans when a cache hit bypasses transport', async () => {
    const telemetry = createTelemetry()
    const adapter = new MockAdapter()
    const request = createClient({ adapter })
      .use(openTelemetryPlugin(telemetry.api))
      .use(cachePlugin())

    adapter.onGet('/cached').reply(200, { ok: true })
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: Infinity
        }
      }
    }

    await request.get('/cached', config)
    await request.get('/cached', config)

    expect(adapter.history).toHaveLength(1)
    expect(telemetry.spans).toHaveLength(1)
  })

  it('should isolate telemetry failures from requests', async () => {
    const adapter = new MockAdapter()

    adapter.onGet('/safe').reply(200, { ok: true })

    const telemetry = createTelemetry()
    telemetry.api.tracer.startSpan = vi.fn(() => {
      throw new Error('SDK unavailable')
    })
    const request = createClient({ adapter }).use(
      openTelemetryPlugin(telemetry.api)
    )

    await expect(request.get('/safe')).resolves.toEqual({ ok: true })
  })

  it('should isolate propagation failures and honor trace filters', async () => {
    const telemetry = createTelemetry()
    const adapter = new MockAdapter()

    telemetry.api.propagation.inject = vi.fn(() => {
      throw new Error('propagator unavailable')
    })
    adapter
      .onGet('/traced')
      .reply(200, { ok: true })
      .onGet('/ignored')
      .reply(200, { ok: true })

    const request = createClient({
      adapter,
      baseURL: 'https://api.example.com'
    }).use(openTelemetryPlugin({
      ...telemetry.api,
      recordException: true,
      shouldTrace: config => config.url !== '/ignored',
      sanitizeUrl: () => undefined
    }))

    await expect(request.get('/traced')).resolves.toEqual({ ok: true })
    await expect(request.get('/ignored')).resolves.toEqual({ ok: true })

    expect(telemetry.spans).toHaveLength(1)
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'npora.request.propagation_error': true
    })
    expect(telemetry.spans[0]?.recordException).toHaveBeenCalledOnce()
  })

  it('should end active spans when the plugin is removed', async () => {
    vi.useFakeTimers()
    const telemetry = createTelemetry()
    const adapter = new MockAdapter({ delay: 1000 })
    const request = createClient({ adapter }).use(
      openTelemetryPlugin(telemetry.api)
    )

    adapter.onGet('/pending').reply(200, { ok: true })

    const pending = request.get('/pending')

    await vi.waitFor(() => expect(telemetry.spans).toHaveLength(1))
    request.unuse('opentelemetry')

    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'npora.request.instrumentation_removed': true
    })
    expect(telemetry.spans[0]?.end).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(telemetry.spans[0]?.end).toHaveBeenCalledOnce()
  })

  it('should reject missing injected APIs at plugin creation', () => {
    expect(() => openTelemetryPlugin({} as OpenTelemetryPluginOptions))
      .toThrow(
        'openTelemetryPlugin requires tracer, context, trace, and propagation APIs'
      )
  })
})

interface TestSpan extends OpenTelemetrySpan {
  name: string
  options: {
    kind?: number
    attributes: Readonly<Record<string, OpenTelemetryAttributeValue>>
  }
  attributes: Record<string, OpenTelemetryAttributeValue>
  statuses: Array<{ code: number; message?: string }>
  end: ReturnType<typeof vi.fn>
  recordException: ReturnType<typeof vi.fn>
}

function createTelemetry(): {
  api: OpenTelemetryPluginOptions
  spans: TestSpan[]
} {
  const spans: TestSpan[] = []
  const api: OpenTelemetryPluginOptions = {
    tracer: {
      startSpan(name, options = {}) {
        const span = {
          name,
          options: {
            ...options,
            attributes: options.attributes ?? {}
          },
          attributes: {},
          statuses: [],
          setAttribute(key, value) {
            this.attributes[key] = value
            return this
          },
          setStatus(status) {
            this.statuses.push(status)
            return this
          },
          recordException: vi.fn(),
          end: vi.fn()
        } satisfies TestSpan

        spans.push(span)
        return span
      }
    },
    context: {
      active() {
        return { active: true }
      }
    },
    trace: {
      setSpan(context, span) {
        return { context, span }
      }
    },
    propagation: {
      inject(_context, carrier, setter) {
        setter.set(
          carrier,
          'traceparent',
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
        )
      }
    }
  }

  return { api, spans }
}
