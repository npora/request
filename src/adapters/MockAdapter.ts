import { RequestError } from '../errors'
import type {
  Adapter,
  HttpMethod,
  NporaResponse,
  QueryParams,
  RequestConfig
} from '../types'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'
import { isBodylessResponse } from '../utils/parseResponse'
import { validateResponseStatus } from '../utils/validateResponseStatus'
import { isURLSearchParams } from '../utils/isURLSearchParams'

export type MockHandler<T = unknown> = (
  config: RequestConfig
) => T | Promise<T>

export type MockURLMatcher = string | RegExp

export interface MockRequestMatcher {
  url: MockURLMatcher

  query?: QueryParams

  searchParams?: URLSearchParams

  headers?: HeadersInit
}

export interface MockReply<T = unknown> {
  status: number

  data?: T

  headers?: HeadersInit

  statusText?: string

  delay?: number
}

export type MockReplyHandler<T = unknown> = (
  config: RequestConfig
) => MockReply<T> | Promise<MockReply<T>>

export interface MockResponseOptions {
  headers?: HeadersInit

  statusText?: string

  delay?: number
}

export interface MockRoute {
  reply<T = unknown>(handler: MockReplyHandler<T>): MockAdapter

  reply<T = unknown>(
    status: number,
    data?: T,
    options?: MockResponseOptions
  ): MockAdapter

  replyOnce<T = unknown>(handler: MockReplyHandler<T>): MockAdapter

  replyOnce<T = unknown>(
    status: number,
    data?: T,
    options?: MockResponseOptions
  ): MockAdapter

  networkError(message?: string): MockAdapter

  networkErrorOnce(message?: string): MockAdapter

  timeout(message?: string): MockAdapter

  timeoutOnce(message?: string): MockAdapter
}

export interface MockAdapterOptions {
  handlers?: Record<string, MockHandler>

  /**
   * Default delay for mock handlers and routes.
   *
   * @default 0
   */
  delay?: number
}

interface MockRule {
  method?: HttpMethod

  matcher: MockRequestMatcher

  once: boolean

  respond(config: RequestConfig): Promise<NporaResponse<unknown>>
}

export class MockAdapter implements Adapter {
  private readonly handlers = new Map<string, MockHandler>()

  private readonly rules: MockRule[] = []

  private readonly requests: RequestConfig[] = []

  private readonly delay: number

  constructor(options: MockAdapterOptions = {}) {
    this.delay = normalizeDelay(options.delay)

    Object.entries(options.handlers ?? {}).forEach(([key, handler]) => {
      this.handlers.set(key, handler)
    })
  }

  get history(): readonly RequestConfig[] {
    return [...this.requests]
  }

  /**
   * Register a legacy URL-only data handler.
   */
  on<T = unknown>(url: string, handler: MockHandler<T>): this {
    this.handlers.set(url, handler as MockHandler)

    return this
  }

  onMethod(
    method: HttpMethod,
    matcher: MockURLMatcher | MockRequestMatcher
  ): MockRoute {
    const normalizedMatcher = normalizeMatcher(matcher)
    const registrar: RouteRegistrar = {
      reply: (once, replyOrStatus, data, options) => {
        return this.registerReply(
          method,
          normalizedMatcher,
          once,
          replyOrStatus,
          data,
          options
        )
      },
      error: (once, code, message) => {
        return this.registerError(
          method,
          normalizedMatcher,
          once,
          code,
          message
        )
      }
    }

    return new RouteBuilder(registrar)
  }

  onGet(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('GET', matcher)
  }

  onPost(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('POST', matcher)
  }

  onPut(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('PUT', matcher)
  }

  onPatch(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('PATCH', matcher)
  }

  onDelete(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('DELETE', matcher)
  }

  onHead(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('HEAD', matcher)
  }

  onOptions(matcher: MockURLMatcher | MockRequestMatcher): MockRoute {
    return this.onMethod('OPTIONS', matcher)
  }

  resetHistory(): this {
    this.requests.length = 0
    return this
  }

  resetHandlers(): this {
    this.handlers.clear()
    this.rules.length = 0
    return this
  }

  reset(): this {
    return this.resetHandlers().resetHistory()
  }

  async request<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    this.requests.push(config)

    const method = config.method ?? 'GET'
    const ruleIndex = this.rules.findIndex(rule => {
      return (
        (rule.method === undefined || rule.method === method) &&
        matchesRequest(rule.matcher, config)
      )
    })

    if (ruleIndex !== -1) {
      const rule = this.rules[ruleIndex]

      if (rule.once) {
        this.rules.splice(ruleIndex, 1)
      }

      const response = await rule.respond(config) as NporaResponse<T>

      return validateMockResponse(response, config)
    }

    const handler = this.handlers.get(config.url)

    if (!handler) {
      throw new Error(
        `No mock handler found for ${config.url} (${method})`
      )
    }

    await waitForDelay(this.delay, config)

    const data = (await handler(config)) as T

    return validateMockResponse(createMockResponse(config, {
      status: 200,
      statusText: 'OK',
      data
    }), config)
  }

  private registerReply<T>(
    method: HttpMethod,
    matcher: MockRequestMatcher,
    once: boolean,
    replyOrStatus: MockReplyHandler<T> | number,
    data?: T,
    options: MockResponseOptions = {}
  ): this {
    const handler: MockReplyHandler<T> =
      typeof replyOrStatus === 'function'
        ? replyOrStatus
        : () => ({
            status: replyOrStatus,
            data,
            ...options
          })

    this.rules.push({
      method,
      matcher,
      once,
      respond: async config => {
        const reply = await handler(config)

        await waitForDelay(
          normalizeDelay(reply.delay ?? this.delay),
          config
        )

        return createMockResponse(config, reply)
      }
    })

    return this
  }

  private registerError(
    method: HttpMethod,
    matcher: MockRequestMatcher,
    once: boolean,
    code: 'NETWORK_ERROR' | 'TIMEOUT_ERROR',
    message: string
  ): this {
    this.rules.push({
      method,
      matcher,
      once,
      respond: async config => {
        await waitForDelay(this.delay, config)

        throw new RequestError(message, {
          code,
          config
        })
      }
    })

    return this
  }
}

interface RouteRegistrar {
  reply<T>(
    once: boolean,
    replyOrStatus: MockReplyHandler<T> | number,
    data: T | undefined,
    options: MockResponseOptions
  ): MockAdapter

  error(
    once: boolean,
    code: 'NETWORK_ERROR' | 'TIMEOUT_ERROR',
    message: string
  ): MockAdapter
}

class RouteBuilder implements MockRoute {
  constructor(private readonly registrar: RouteRegistrar) {}

  reply<T = unknown>(handler: MockReplyHandler<T>): MockAdapter

  reply<T = unknown>(
    status: number,
    data?: T,
    options?: MockResponseOptions
  ): MockAdapter

  reply<T = unknown>(
    replyOrStatus: MockReplyHandler<T> | number,
    data?: T,
    options: MockResponseOptions = {}
  ): MockAdapter {
    return this.registrar.reply(
      false,
      replyOrStatus,
      data,
      options
    )
  }

  replyOnce<T = unknown>(handler: MockReplyHandler<T>): MockAdapter

  replyOnce<T = unknown>(
    status: number,
    data?: T,
    options?: MockResponseOptions
  ): MockAdapter

  replyOnce<T = unknown>(
    replyOrStatus: MockReplyHandler<T> | number,
    data?: T,
    options: MockResponseOptions = {}
  ): MockAdapter {
    return this.registrar.reply(
      true,
      replyOrStatus,
      data,
      options
    )
  }

  networkError(message = 'Mock network error'): MockAdapter {
    return this.registrar.error(
      false,
      'NETWORK_ERROR',
      message
    )
  }

  networkErrorOnce(message = 'Mock network error'): MockAdapter {
    return this.registrar.error(
      true,
      'NETWORK_ERROR',
      message
    )
  }

  timeout(message = 'Mock request timeout'): MockAdapter {
    return this.registrar.error(
      false,
      'TIMEOUT_ERROR',
      message
    )
  }

  timeoutOnce(message = 'Mock request timeout'): MockAdapter {
    return this.registrar.error(
      true,
      'TIMEOUT_ERROR',
      message
    )
  }
}

function normalizeMatcher(
  matcher: MockURLMatcher | MockRequestMatcher
): MockRequestMatcher {
  if (typeof matcher === 'string' || matcher instanceof RegExp) {
    return {
      url: matcher
    }
  }

  return matcher
}

function matchesRequest(
  matcher: MockRequestMatcher,
  config: RequestConfig
): boolean {
  return (
    matchesURL(matcher.url, config.url) &&
    matchesQuery(matcher.query, config.query) &&
    matchesSearchParams(matcher.searchParams, config.searchParams) &&
    matchesHeaders(matcher.headers, config.headers)
  )
}

function matchesURL(matcher: MockURLMatcher, url: string): boolean {
  if (typeof matcher === 'string') {
    return matcher === url
  }

  matcher.lastIndex = 0
  return matcher.test(url)
}

function matchesQuery(
  expected?: QueryParams,
  actual?: QueryParams
): boolean {
  if (!expected) {
    return true
  }

  return normalizeQuery(expected) === normalizeQuery(actual)
}

function normalizeQuery(query?: QueryParams): string {
  if (!query) {
    return '[]'
  }

  const entries: Array<[string, string]> = []

  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    const values = Array.isArray(value) ? value : [value]

    for (const item of values) {
      if (item !== null && item !== undefined) {
        entries.push([key, String(item)])
      }
    }
  }

  return JSON.stringify(entries)
}

function matchesSearchParams(
  expected?: URLSearchParams,
  actual?: URLSearchParams
): boolean {
  if (!expected) {
    return true
  }

  return JSON.stringify([...expected.entries()]) ===
    JSON.stringify([...(actual?.entries() ?? [])])
}

function matchesHeaders(
  expected?: HeadersInit,
  actual?: HeadersInit
): boolean {
  if (!expected) {
    return true
  }

  const expectedHeaders = new Headers(expected)
  const actualHeaders = new Headers(actual)

  for (const [name, value] of expectedHeaders.entries()) {
    if (actualHeaders.get(name) !== value) {
      return false
    }
  }

  return true
}

function createMockResponse<T>(
  config: RequestConfig,
  reply: MockReply<T>
): NporaResponse<T> {
  const headers = new Headers(reply.headers)
  const rawBody = createRawBody(reply.data, headers, reply.status)
  const statusText =
    reply.statusText ?? defaultStatusText(reply.status)
  const raw = new Response(rawBody, {
    status: reply.status,
    statusText,
    headers
  })

  return {
    data: reply.data as T,
    status: reply.status,
    statusText,
    headers: raw.headers,
    config,
    raw
  }
}

function validateMockResponse<T>(
  response: NporaResponse<T>,
  config: RequestConfig
): NporaResponse<T> {
  if (!validateResponseStatus(response.status, config)) {
    throw new RequestError(
      response.statusText || 'Mock request failed',
      {
        code: 'HTTP_ERROR',
        response
      }
    )
  }

  return response
}

function defaultStatusText(status: number): string {
  return STATUS_TEXT[status] ?? ''
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
}

function createRawBody(
  data: unknown,
  headers: Headers,
  status: number
): BodyInit | null {
  if (
    data === undefined ||
    data === null ||
    isBodylessResponse(undefined, status)
  ) {
    return null
  }

  if (typeof data === 'string' || isBodyInit(data)) {
    return data
  }

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  return JSON.stringify(data)
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof FormData !== 'undefined' && value instanceof FormData) ||
    isURLSearchParams(value) ||
    (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
}

function normalizeDelay(delay?: number): number {
  if (!Number.isFinite(delay)) {
    return delay && delay > 0 ? MAX_TIMER_DELAY : 0
  }

  return Math.min(Math.max(0, delay ?? 0), MAX_TIMER_DELAY)
}

function waitForDelay(
  delay: number,
  config: RequestConfig
): Promise<void> {
  const signal = config.signal

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason, config))
  }

  const timeout = config.timeout && config.timeout > 0
    ? config.timeout
    : undefined
  const timeoutWins = timeout !== undefined && timeout <= delay
  const wait = timeoutWins ? timeout : delay

  if (wait <= 0) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()

      if (timeoutWins) {
        reject(
          new RequestError(`Request timeout after ${timeout}ms`, {
            code: 'TIMEOUT_ERROR',
            config
          })
        )
      } else {
        resolve()
      }
    }, wait)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(createAbortError(signal?.reason, config))
    }
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, {
      once: true
    })
  })
}

function createAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  return new RequestError('Mock request aborted', {
    code: 'ABORT_ERROR',
    config,
    cause: reason
  })
}
