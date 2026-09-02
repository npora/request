import { isRequestError } from '../errors'
import type {
  OpenTelemetryAttributeValue,
  OpenTelemetryMetricsOptions,
  RequestConfig
} from '../types'
import type { RequestContext } from '../core/RequestContext'
import { isReadableStream } from '../utils/isReadableStream'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export type OpenTelemetryMetricAttributes = Readonly<Record<
  string,
  OpenTelemetryAttributeValue
>>

export interface OpenTelemetryCounter {
  add(value: number, attributes?: OpenTelemetryMetricAttributes): void
}

export interface OpenTelemetryHistogram {
  record(value: number, attributes?: OpenTelemetryMetricAttributes): void
}

export interface OpenTelemetryMeter {
  createCounter(
    name: string,
    options?: { description?: string; unit?: string }
  ): OpenTelemetryCounter

  createUpDownCounter(
    name: string,
    options?: { description?: string; unit?: string }
  ): OpenTelemetryCounter

  createHistogram(
    name: string,
    options?: { description?: string; unit?: string }
  ): OpenTelemetryHistogram
}

export interface OpenTelemetryMetricsPluginOptions {
  meter: OpenTelemetryMeter

  /** Metric convention to emit. @default 'npora' */
  semconv?: 'npora' | 'stable' | 'both'

  /** Static low-cardinality attributes added to every measurement. */
  attributes?: OpenTelemetryMetricAttributes

  /** Record internal background cache refreshes. @default false */
  includeBackground?: boolean

  /** Measure returned stream consumption until completion or cancellation. @default true */
  measureStreamConsumption?: boolean

  /** Decide whether a request should be measured. */
  shouldRecord?: (config: RequestConfig) => boolean
}

interface MetricState {
  attributes: Record<string, OpenTelemetryAttributeValue>
  httpAttrs?: Record<string, OpenTelemetryAttributeValue>
  startedAt: number
  attemptStart?: number
  retries: number
  measureStream: boolean
}

interface StreamMetricState {
  attributes: Record<string, OpenTelemetryAttributeValue>
  startedAt: number
}

type StreamOutcome = 'complete' | 'cancelled' | 'error' |
  'instrumentation_removed'

/**
 * Record low-cardinality request, retry, cache, and limiter metrics without a
 * runtime dependency on an OpenTelemetry SDK.
 */
export function openTelemetryMetricsPlugin(
  options: OpenTelemetryMetricsPluginOptions
): Plugin {
  validateOptions(options)
  const semconv = options.semconv ?? 'npora'

  const [
    requestDuration,
    rateLimitWaitDuration,
    activeRequests,
    retryAttempts,
    cacheRequests,
    streamDuration,
    activeStreams
  ] = semconv !== 'stable' ? [
    safeCreateHistogram(
      options.meter,
      'npora.client.request.duration',
      'ms'
    ),
    safeCreateHistogram(
      options.meter,
      'npora.client.rate_limit.wait.duration',
      'ms'
    ),
    safeCreateUpDownCounter(
      options.meter,
      'npora.client.active_requests',
      '{request}'
    ),
    safeCreateCounter(
      options.meter,
      'npora.client.retry.attempts',
      '{attempt}'
    ),
    safeCreateCounter(
      options.meter,
      'npora.client.cache.requests',
      '{request}'
    ),
    safeCreateHistogram(
      options.meter,
      'npora.client.stream.duration',
      'ms'
    ),
    safeCreateUpDownCounter(
      options.meter,
      'npora.client.active_streams',
      '{stream}'
    )
  ] : []
  const stableRequestDuration = semconv !== 'npora' ? safeCreateHistogram(
    options.meter,
    'http.client.request.duration',
    's'
  ) : undefined
  const states = new WeakMap<object, MetricState>()
  const activeStates = new Set<MetricState>()
  const streamStates = new Set<StreamMetricState>()

  return {
    name: 'opentelemetry-metrics',
    priority: -2000,

    install(context) {
      context.hooks.onRequest(requestContext => {
        let requestOptions: OpenTelemetryMetricsOptions | undefined

        try {
          requestOptions = resolveExtensionConfig(
            requestContext.config,
            'openTelemetryMetrics'
          )
        } catch {
          return
        }

        if (
          requestOptions?.enabled === false ||
          (!options.includeBackground && requestContext.background) ||
          !shouldRecord(options, requestContext.config)
        ) {
          return
        }

        let state: MetricState

        try {
          const attributes = createAttributes(
            options,
            requestContext.config,
            requestOptions
          )
          const httpAttrs = stableRequestDuration
            ? { ...attributes }
            : undefined

          if (httpAttrs) {
            try {
              const config = requestContext.config
              const url = config.baseURL
                ? new URL(config.url, config.baseURL)
                : new URL(config.url)

              httpAttrs['server.address'] = url.hostname
              if (url.port) httpAttrs['server.port'] = +url.port
            } catch {}
          }

          state = {
            attributes,
            httpAttrs,
            startedAt: requestContext.startTime,
            retries: 0,
            measureStream:
              requestOptions?.measureStreamConsumption ??
              options.measureStreamConsumption ?? true
          }
        } catch {
          return
        }

        states.set(requestContext, state)
        activeStates.add(state)
        safeAdd(activeRequests, 1, state.attributes)
      }, {
        // Start before feature hooks so cache lookup time and hook failures are
        // included in request duration and active-request measurements.
        priority: Number.MAX_SAFE_INTEGER
      })

      context.hooks.onTransport(requestContext => {
        const state = states.get(requestContext)

        if (state) {
          if (stableRequestDuration) state.attemptStart = Date.now()

          if (requestContext.attempt > 0) {
            state.retries += 1
          }
        }
      })

      const recordAttempt = (requestContext: RequestContext<unknown>) => {
        const state = states.get(requestContext)

        if (!state?.httpAttrs || state.attemptStart === undefined) return
        safeRecord(
          stableRequestDuration,
          Math.max(0, Date.now() - state.attemptStart) / 1000,
          createResultAttributes(state.httpAttrs, requestContext)
        )
        state.attemptStart = undefined
      }

      context.hooks.onResponse(recordAttempt, { requiresRawResponse: false })
      context.hooks.onError(recordAttempt)

      context.hooks.onSettled(requestContext => {
        const state = states.get(requestContext)

        if (!state) {
          return
        }

        const outcomeAttributes = createResultAttributes(
          state.attributes,
          requestContext,
          true
        )

        safeRecord(
          requestDuration,
          Math.max(0, Date.now() - state.startedAt),
          outcomeAttributes
        )

        if (state.retries > 0) {
          safeAdd(
            retryAttempts,
            state.retries,
            outcomeAttributes
          )
        }

        if (requestContext.rateLimitApplied) {
          safeRecord(
            rateLimitWaitDuration,
            requestContext.rateLimitWaitTime,
            outcomeAttributes
          )
        }

        if (isCacheEnabled(requestContext.config)) {
          safeAdd(cacheRequests, 1, {
            ...outcomeAttributes,
            'cache.result': requestContext.cacheHit ? 'hit' : 'miss'
          })
        }

        if (
          requestContext.response &&
          state.measureStream
        ) {
          instrumentStreamConsumption(
            requestContext,
            outcomeAttributes,
            streamDuration,
            activeStreams,
            streamStates
          )
        }

        finishState(state, activeStates, activeRequests)
        states.delete(requestContext)
      })

      return () => {
        for (const state of activeStates) {
          finishState(state, activeStates, activeRequests)
        }


        for (const state of streamStates) {
          finishStreamState(
            state,
            'instrumentation_removed',
            streamStates,
            activeStreams,
            streamDuration
          )
        }
      }
    }
  }
}

function instrumentStreamConsumption(
  context: RequestContext<unknown>,
  attributes: OpenTelemetryMetricAttributes,
  duration: OpenTelemetryHistogram | undefined,
  activeInstrument: OpenTelemetryCounter | undefined,
  activeStates: Set<StreamMetricState>
): void {
  const response = context.response

  if (!response) {
    return
  }

  const data = response.data
  const streamType = resolveStreamType(data, response)

  if (!streamType) {
    return
  }

  const state: StreamMetricState = {
    attributes: {
      ...attributes,
      'stream.type': streamType
    },
    startedAt: Date.now()
  }
  const finish = (outcome: StreamOutcome) => {
    finishStreamState(
      state,
      outcome,
      activeStates,
      activeInstrument,
      duration
    )
  }

  try {
    if (isReadableStream(data)) {
      const measured = measureReadableStream(data, finish)
      const raw = createStreamResponse(response.raw, measured)

      response.data = raw.body
      response.raw = raw
    } else if (isAsyncIterable(data)) {
      response.data = measureAsyncIterable(data, finish)
    } else {
      return
    }
  } catch {
    return
  }

  activeStates.add(state)
  safeAdd(activeInstrument, 1, state.attributes)
}

function measureAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  finish: (outcome: StreamOutcome) => void
): AsyncIterable<T> {
  return (async function* () {
    let outcome: StreamOutcome = 'cancelled'

    try {
      yield* iterable
      outcome = 'complete'
    } catch (error) {
      outcome = 'error'
      throw error
    } finally {
      finish(outcome)
    }
  })()
}

function measureReadableStream(
  stream: ReadableStream<Uint8Array>,
  finish: (outcome: StreamOutcome) => void
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let settled = false
  const settle = (outcome: StreamOutcome) => {
    if (settled) {
      return
    }

    settled = true

    try {
      reader.releaseLock()
    } catch {
      // Consumption outcome must still be recorded.
    }

    finish(outcome)
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()

        if (result.done) {
          settle('complete')
          controller.close()
          return
        }

        controller.enqueue(result.value)
      } catch (error) {
        settle('error')
        controller.error(error)
      }
    },

    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        settle('cancelled')
      }
    }
  })
}

function createStreamResponse(
  source: Response,
  stream: ReadableStream<Uint8Array>
): Response {
  const response = new Response(stream, {
    status: source.status,
    statusText: source.statusText,
    headers: source.headers
  })

  for (const key of ['url', 'redirected', 'type'] as const) {
    try {
      Object.defineProperty(response, key, {
        value: source[key],
        configurable: true
      })
    } catch {
      // Native response metadata is best-effort across runtimes.
    }
  }

  return response
}

function resolveStreamType(
  data: unknown,
  response: { headers: Headers }
): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined
  }

  try {
    if ('getReader' in data && isReadableStream(data)) {
      return 'bytes'
    }

    if (!(Symbol.asyncIterator in data)) {
      return undefined
    }
  } catch {
    return undefined
  }

  const contentType = response.headers.get('content-type')?.toLowerCase()

  return contentType?.includes('text/event-stream') ? 'sse' : 'ndjson'
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
}

function finishStreamState(
  state: StreamMetricState,
  outcome: StreamOutcome,
  activeStates: Set<StreamMetricState>,
  activeInstrument: OpenTelemetryCounter | undefined,
  duration: OpenTelemetryHistogram | undefined
): void {
  if (!activeStates.delete(state)) {
    return
  }

  const attributes = {
    ...state.attributes,
    'stream.outcome': outcome
  }

  safeRecord(
    duration,
    Math.max(0, Date.now() - state.startedAt),
    attributes
  )
  // Up/down measurements must use the exact same attribute set so the
  // original active-stream series is balanced.
  safeAdd(activeInstrument, -1, state.attributes)
}

function isCacheEnabled(config: RequestConfig): boolean {
  try {
    return resolveExtensionConfig(config, 'cache')?.enabled === true
  } catch {
    return false
  }
}

function createAttributes(
  options: OpenTelemetryMetricsPluginOptions,
  config: RequestConfig,
  requestOptions: OpenTelemetryMetricsOptions | undefined
): Record<string, OpenTelemetryAttributeValue> {
  return {
    ...options.attributes,
    ...requestOptions?.attributes,
    'http.request.method': config.method ?? 'GET'
  }
}

function createResultAttributes(
  attributes: OpenTelemetryMetricAttributes,
  context: RequestContext<unknown>,
  includeOutcome = false
): Record<string, OpenTelemetryAttributeValue> {
  const result: Record<string, OpenTelemetryAttributeValue> = {
    ...attributes
  }

  if (includeOutcome) {
    result['request.outcome'] = context.error ? 'error' : 'success'
  }

  const status = context.response?.status ?? (
    isRequestError(context.error) ? context.error.status : undefined
  )

  if (status !== undefined) result['http.response.status_code'] = status

  if (context.error) {
    result['error.type'] = resolveErrorType(context.error)
  }

  return result
}

function resolveErrorType(error: unknown): string {
  if (isRequestError(error)) {
    return error.status === undefined ? error.code : String(error.status)
  }

  return '_OTHER'
}

function finishState(
  state: MetricState,
  activeStates: Set<MetricState>,
  instrument: OpenTelemetryCounter | undefined
): void {
  if (!activeStates.delete(state)) {
    return
  }

  safeAdd(instrument, -1, state.attributes)
}

function shouldRecord(
  options: OpenTelemetryMetricsPluginOptions,
  config: RequestConfig
): boolean {
  try {
    return options.shouldRecord?.(config) ?? true
  } catch {
    return false
  }
}

function safeCreateCounter(
  meter: OpenTelemetryMeter,
  name: string,
  unit: string
): OpenTelemetryCounter | undefined {
  try {
    return meter.createCounter(name, { unit })
  } catch {
    return undefined
  }
}

function safeCreateUpDownCounter(
  meter: OpenTelemetryMeter,
  name: string,
  unit: string
): OpenTelemetryCounter | undefined {
  try {
    return meter.createUpDownCounter(name, { unit })
  } catch {
    return undefined
  }
}

function safeCreateHistogram(
  meter: OpenTelemetryMeter,
  name: string,
  unit: string
): OpenTelemetryHistogram | undefined {
  try {
    return meter.createHistogram(name, { unit })
  } catch {
    return undefined
  }
}

function safeAdd(
  instrument: OpenTelemetryCounter | undefined,
  value: number,
  attributes: OpenTelemetryMetricAttributes
): void {
  try {
    instrument?.add(value, attributes)
  } catch {
    // Metrics exporters cannot affect requests.
  }
}

function safeRecord(
  instrument: OpenTelemetryHistogram | undefined,
  value: number,
  attributes: OpenTelemetryMetricAttributes
): void {
  try {
    instrument?.record(value, attributes)
  } catch {
    // Metrics exporters cannot affect requests.
  }
}

function validateOptions(options: OpenTelemetryMetricsPluginOptions): void {
  if (
    !options ||
    typeof options.meter?.createCounter !== 'function' ||
    typeof options.meter?.createUpDownCounter !== 'function' ||
    typeof options.meter?.createHistogram !== 'function'
  ) {
    throw new TypeError()
  }

}
