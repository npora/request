import { isRequestError } from '../errors'
import type {
  OpenTelemetryAttributeValue,
  OpenTelemetryOptions,
  RequestConfig
} from '../types'
import type { RequestContext } from '../core/RequestContext'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

const SPAN_KIND_CLIENT = 2
const SPAN_STATUS_UNSET = 0
const SPAN_STATUS_ERROR = 2

export interface OpenTelemetrySpan {
  setAttribute(name: string, value: OpenTelemetryAttributeValue): this
  setStatus(status: { code: number; message?: string }): this
  recordException(exception: unknown): void
  end(endTime?: unknown): void
}

export interface OpenTelemetryTracer {
  startSpan(
    name: string,
    options?: {
      kind?: number
      attributes?: Readonly<Record<string, OpenTelemetryAttributeValue>>
    },
    context?: unknown
  ): OpenTelemetrySpan
}

export interface OpenTelemetryContextApi {
  active(): unknown
}

export interface OpenTelemetryTraceApi {
  setSpan(context: unknown, span: OpenTelemetrySpan): unknown
}

export interface OpenTelemetryPropagationApi {
  inject(
    context: unknown,
    carrier: Headers,
    setter: OpenTelemetryHeaderSetter
  ): void
}

export interface OpenTelemetryHeaderSetter {
  set(carrier: Headers, key: string, value: string): void
}

export interface OpenTelemetryPluginOptions {
  tracer: OpenTelemetryTracer
  context: OpenTelemetryContextApi
  trace: OpenTelemetryTraceApi
  propagation: OpenTelemetryPropagationApi

  /** Inject trace context into outgoing headers. @default true */
  propagate?: boolean

  /** Record exception events, which may include sensitive messages. @default false */
  recordException?: boolean

  /** Static attributes added before per-request attributes. */
  attributes?: Readonly<Record<string, OpenTelemetryAttributeValue>>

  /** Decide whether an actual transport attempt should be traced. */
  shouldTrace?: (config: RequestConfig) => boolean

  /**
   * Sanitize the absolute request URL used for `url.full`.
   * Return undefined to omit the attribute.
   *
   * @default strips credentials, query, and fragment
   */
  sanitizeUrl?: (url: URL, config: RequestConfig) => string | undefined
}

interface AttemptState {
  span: OpenTelemetrySpan
  ended: boolean
}

const HEADER_SETTER: OpenTelemetryHeaderSetter = {
  set(carrier, key, value) {
    carrier.set(key, value)
  }
}

/**
 * Trace each actual HTTP transport attempt without depending on an OTel SDK.
 */
export function openTelemetryPlugin(
  options: OpenTelemetryPluginOptions
): Plugin {
  validateOptions(options)
  const attempts = new WeakMap<object, AttemptState>()
  const activeAttempts = new Set<AttemptState>()

  return {
    name: 'opentelemetry',
    // Cache, circuit, and concurrency request hooks should finish first.
    priority: -1000,

    install(pluginContext) {
      const start = (requestContext: RequestContext<unknown>) => {
        const requestOptions = resolveExtensionConfig(
          requestContext.config,
          'openTelemetry'
        )

        if (
          requestOptions?.enabled === false ||
          !shouldTrace(options, requestContext.config)
        ) {
          return
        }

        const current = attempts.get(requestContext)

        if (current && !current.ended) {
          return
        }

        const attempt = startAttempt(options, requestContext, requestOptions)

        if (attempt) {
          attempts.set(requestContext, attempt)
          activeAttempts.add(attempt)
        }
      }

      // The first validated Fetch fast path freezes headers before transport
      // hooks, so its context must be injected from the final request hook.
      pluginContext.hooks.onRequest(requestContext => {
        if (!requestContext.response) {
          start(requestContext)
        }
      })

      // Failed attempts are ended by onError; retries start here after rate
      // limiting and immediately before the next adapter dispatch.
      pluginContext.hooks.onTransport(start)

      pluginContext.hooks.onResponse(requestContext => {
        const attempt = attempts.get(requestContext)
        const status = requestContext.response?.status

        if (!attempt || status === undefined) {
          return
        }

        safeSetAttribute(attempt.span, 'http.response.status_code', status)

        if (status >= 400) {
          markError(attempt.span, String(status))
        }
      }, { requiresRawResponse: false })

      pluginContext.hooks.onError(requestContext => {
        const attempt = attempts.get(requestContext)

        if (!attempt) {
          return
        }

        recordError(attempt.span, requestContext.error, options)
        endAttempt(attempt, activeAttempts)
        attempts.delete(requestContext)
      })

      pluginContext.hooks.onSettled(requestContext => {
        const attempt = attempts.get(requestContext)

        endAttempt(attempt, activeAttempts)
        attempts.delete(requestContext)
      })

      return () => {
        for (const attempt of activeAttempts) {
          safeSetAttribute(
            attempt.span,
            'npora.request.instrumentation_removed',
            true
          )
          endAttempt(attempt, activeAttempts)
        }
      }
    }
  }
}

function startAttempt(
  options: OpenTelemetryPluginOptions,
  context: RequestContext<unknown>,
  requestOptions: OpenTelemetryOptions | undefined
): AttemptState | undefined {
  try {
    const parent = options.context.active()
    const method = context.config.method ?? 'GET'
    const span = options.tracer.startSpan(
      requestOptions?.spanName ?? method,
      {
        kind: SPAN_KIND_CLIENT,
        attributes: createAttributes(options, context, requestOptions)
      },
      parent
    )
    const attempt = { span, ended: false }

    if ((requestOptions?.propagate ?? options.propagate ?? true)) {
      try {
        const carrier = new Headers(context.config.headers)
        const spanContext = options.trace.setSpan(parent, span)

        options.propagation.inject(spanContext, carrier, HEADER_SETTER)
        context.config.headers = carrier
      } catch (error) {
        safeSetAttribute(span, 'npora.request.propagation_error', true)
        safeRecordException(span, error, options.recordException === true)
      }
    }

    return attempt
  } catch {
    // Telemetry SDK failures must never change the request result.
    return undefined
  }
}

function createAttributes(
  options: OpenTelemetryPluginOptions,
  context: RequestContext<unknown>,
  requestOptions: OpenTelemetryOptions | undefined
): Readonly<Record<string, OpenTelemetryAttributeValue>> {
  const method = context.config.method ?? 'GET'
  const attributes: Record<string, OpenTelemetryAttributeValue> = {
    ...options.attributes,
    ...requestOptions?.attributes,
    'http.request.method': method
  }

  if (context.attempt > 0) {
    attributes['http.request.resend_count'] = context.attempt
  }

  const url = resolveURL(context.config)

  if (!url) {
    return attributes
  }

  attributes['server.address'] = url.hostname
  attributes['url.scheme'] = url.protocol.slice(0, -1)

  const port = resolvePort(url)

  if (port !== undefined) {
    attributes['server.port'] = port
  }

  const full = sanitizeURL(options, url, context.config)

  if (full !== undefined) {
    attributes['url.full'] = full
  }

  return attributes
}

function recordError(
  span: OpenTelemetrySpan,
  error: unknown,
  options: OpenTelemetryPluginOptions
): void {
  if (isRequestError(error) && error.status !== undefined) {
    safeSetAttribute(
      span,
      'http.response.status_code',
      error.status
    )
  }

  if (isRequestError(error) && error.code === 'ABORT_ERROR') {
    safeSetAttribute(span, 'npora.request.cancelled', true)
    safeSetStatus(span, SPAN_STATUS_UNSET)
    return
  }

  const errorType = resolveErrorType(error)

  markError(span, errorType)
  safeRecordException(span, error, options.recordException === true)
}

function resolveErrorType(error: unknown): string {
  if (isRequestError(error)) {
    if (error.code === 'TIMEOUT_ERROR') {
      return 'timeout'
    }

    if (error.code === 'HTTP_ERROR' && error.status !== undefined) {
      return String(error.status)
    }

    return error.code
  }

  try {
    if (
      typeof error === 'object' &&
      error !== null &&
      typeof Reflect.get(error, 'name') === 'string'
    ) {
      return Reflect.get(error, 'name') as string
    }
  } catch {
    // Use the privacy-safe fallback below.
  }

  return '_OTHER'
}

function markError(span: OpenTelemetrySpan, errorType: string): void {
  safeSetAttribute(span, 'error.type', errorType)
  safeSetStatus(span, SPAN_STATUS_ERROR)
}

function endAttempt(
  attempt: AttemptState | undefined,
  activeAttempts: Set<AttemptState>
): void {
  if (!attempt || attempt.ended) {
    return
  }

  attempt.ended = true
  activeAttempts.delete(attempt)

  try {
    attempt.span.end()
  } catch {
    // Telemetry exporters cannot affect the request result.
  }
}

function safeSetAttribute(
  span: OpenTelemetrySpan,
  name: string,
  value: OpenTelemetryAttributeValue
): void {
  try {
    span.setAttribute(name, value)
  } catch {
    // Telemetry exporters cannot affect the request result.
  }
}

function safeSetStatus(span: OpenTelemetrySpan, code: number): void {
  try {
    span.setStatus({ code })
  } catch {
    // Telemetry exporters cannot affect the request result.
  }
}

function safeRecordException(
  span: OpenTelemetrySpan,
  error: unknown,
  enabled: boolean
): void {
  if (!enabled) {
    return
  }

  try {
    span.recordException(error)
  } catch {
    // Telemetry exporters cannot affect the request result.
  }
}

function shouldTrace(
  options: OpenTelemetryPluginOptions,
  config: RequestConfig
): boolean {
  try {
    return options.shouldTrace?.(config) ?? true
  } catch {
    return false
  }
}

function resolveURL(config: RequestConfig): URL | undefined {
  try {
    return config.baseURL
      ? new URL(String(config.url), config.baseURL)
      : new URL(String(config.url))
  } catch {
    return undefined
  }
}

function resolvePort(url: URL): number | undefined {
  if (url.port !== '') {
    const port = Number(url.port)

    return Number.isSafeInteger(port) ? port : undefined
  }

  if (url.protocol === 'https:') {
    return 443
  }

  return url.protocol === 'http:' ? 80 : undefined
}

function sanitizeURL(
  options: OpenTelemetryPluginOptions,
  url: URL,
  config: RequestConfig
): string | undefined {
  try {
    if (options.sanitizeUrl) {
      return options.sanitizeUrl(new URL(url), config)
    }

    const safe = new URL(url)

    safe.username = ''
    safe.password = ''
    safe.search = ''
    safe.hash = ''
    return safe.href
  } catch {
    return undefined
  }
}

function validateOptions(options: OpenTelemetryPluginOptions): void {
  if (
    !options ||
    typeof options.tracer?.startSpan !== 'function' ||
    typeof options.context?.active !== 'function' ||
    typeof options.trace?.setSpan !== 'function' ||
    typeof options.propagation?.inject !== 'function'
  ) {
    throw new TypeError(
      'openTelemetryPlugin requires tracer, context, trace, and propagation APIs'
    )
  }
}
