import { isRequestError } from '../errors'
import { isPromiseLike } from '../utils/isPromiseLike'
import type { Adapter, HttpMethod, NporaResponse, QueryParams, RequestConfig } from '../types'

/** JSON values that can be replayed without constructors or live streams. */
export type MockRecordedData = null | boolean | number | string |
  MockRecordedData[] | { [key: string]: MockRecordedData }

export interface MockRecording {
  method: HttpMethod
  matcher: {
    url: string
    query?: QueryParams
    searchParams?: Array<[string, string]>
  }
  response: {
    status: number
    statusText: string
    headers: Record<string, string>
    data?: MockRecordedData
  }
}

export interface MockRecordOptions {
  /** Unmatched requests are explicitly forwarded to this adapter. */
  adapter: Adapter
  /** Maximum retained responses, in request invocation order. Default: 100. */
  maxEntries?: number
  /** Maximum UTF-8 JSON bytes per complete recording. Default: 262144. */
  maxRecordSize?: number
  /** Synchronous final redaction/filter. Return undefined to skip a recording. */
  transform?: (recording: MockRecording) => MockRecording | undefined
}

export interface MockRecordingStats {
  recorded: number
  skipped: number
}

interface Capture {
  id: number
  generation: number
  method: HttpMethod
  matcher: MockRecording['matcher']
}

/** Internal, opt-in recorder. It never reads raw bodies or consumes streams. */
export class MockRecorder {
  private readonly adapter: Adapter
  private readonly maxEntries: number
  private readonly maxRecordSize: number
  private readonly transform: MockRecordOptions['transform']
  private readonly entries = new Map<number, string>()
  private skipped = 0
  private sequence = 0
  private generation = 0

  constructor(options: MockRecordOptions) {
    if (!options || typeof options.adapter?.request !== 'function') {
      throw new TypeError('Mock recording requires an adapter')
    }
    this.maxEntries = positiveInteger(options.maxEntries, 100)
    this.maxRecordSize = positiveInteger(options.maxRecordSize, 262144)
    if (options.transform !== undefined && typeof options.transform !== 'function') {
      throw new TypeError('Mock recording transform must be a function')
    }
    this.adapter = options.adapter
    this.transform = options.transform
  }

  get recordings(): readonly MockRecording[] {
    return [...this.entries].sort(([a], [b]) => a - b).map(([, value]) => JSON.parse(value))
  }

  get stats(): MockRecordingStats {
    return { recorded: this.entries.size, skipped: this.skipped }
  }

  clear(): void {
    this.generation++
    this.entries.clear()
    this.skipped = 0
  }

  exportMocks(): string {
    return this.recordings.map(({ method, matcher, response }) => {
      const searchParams = matcher.searchParams
        ? `, searchParams: new URLSearchParams(${literal(matcher.searchParams)})`
        : ''
      const match = `{ url: ${literal(matcher.url)}${matcher.query ? `, query: JSON.parse(${literal(JSON.stringify(matcher.query))})` : ''}${searchParams} }`
      const data = response.data === undefined
        ? 'undefined' : `JSON.parse(${literal(JSON.stringify(response.data))})`
      const options = JSON.stringify({ headers: response.headers, statusText: response.statusText })
      return `mock.onMethod(${literal(method)}, ${match}).replyOnce(${response.status}, ${data}, JSON.parse(${literal(options)}));`
    }).join('\n')
  }

  async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
    const generation = this.generation
    let capture: Capture | undefined
    try {
      capture = {
        id: this.sequence++, generation, method: config.method ?? 'GET',
        matcher: snapshotMatcher(config, this.maxRecordSize)
      }
    } catch { this.skipped++ }
    let response: NporaResponse<T>
    try {
      response = await this.adapter.request<T>(config)
    } catch (error) {
      if (capture && generation === this.generation) {
        try {
          if (isRequestError(error) && error.code === 'HTTP_ERROR' && error.response) {
            this.record(capture, error.response)
          } else { this.skipped++ }
        } catch { this.skipped++ }
      }
      throw error
    }
    if (capture) this.record(capture, response)
    return response
  }

  private record(capture: Capture, response: NporaResponse<unknown>): void {
    if (capture.generation !== this.generation) return
    try {
      const headers = Object.fromEntries([...response.headers].filter(([key]) => !sensitive(key) && !/^(content-length|content-encoding|transfer-encoding)$/i.test(key)))
      const recording: MockRecording = {
        method: capture.method, matcher: capture.matcher,
        response: { status: response.status, statusText: response.statusText, headers }
      }
      if (response.data !== undefined) recording.response.data = snapshot(response.data, this.maxRecordSize)
      const transformed = this.transform ? this.transform(recording) : recording
      if (isPromiseLike(transformed)) {
        void Promise.resolve(transformed).catch(() => {})
        if (capture.generation === this.generation) this.skipped++
        return
      }
      if (capture.generation !== this.generation) return
      if (!transformed) { this.skipped++; return }
      // Revalidate, redact and bound custom transformations too.
      const copied = snapshot(transformed, this.maxRecordSize) as unknown as MockRecording
      validateRecording(copied)
      const serialized = JSON.stringify(copied)
      if (capture.generation !== this.generation) return
      this.entries.set(capture.id, serialized)
      if (this.entries.size > this.maxEntries) {
        this.entries.delete([...this.entries.keys()].reduce((a, b) => Math.min(a, b)))
      }
    } catch { if (capture.generation === this.generation) this.skipped++ }
  }
}

function validateRecording(value: MockRecording): void {
  if (
    !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'QUERY'].includes(value.method) ||
    typeof value.matcher?.url !== 'string' ||
    !Number.isInteger(value.response?.status) || value.response.status < 200 || value.response.status > 599 ||
    typeof value.response.statusText !== 'string'
  ) throw new TypeError('Invalid recording')
  // A transformation cannot reintroduce credential URLs or queries.
  snapshotMatcher({ ...value.matcher,
    searchParams: value.matcher.searchParams ? new URLSearchParams(value.matcher.searchParams) : undefined
  }, Number.MAX_SAFE_INTEGER)
  if (!value.response.headers || Object.values(value.response.headers).some(header => typeof header !== 'string')) {
    throw new TypeError('Invalid recorded headers')
  }
  new Headers(value.response.headers)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Mock recording limits must be positive safe integers')
  }
  return value
}

function sensitive(key: string): boolean {
  return /^(?:authorization|proxyauthorization|cookie|setcookie|password|passwd|secret|token|accesstoken|refreshtoken|apikey|xapikey|clientsecret|sessionid|csrftoken|xcsrftoken|xsrftoken|xxsrftoken|xauthtoken)$/i.test(key.replace(/[-_]/g, ''))
}

function snapshotMatcher(config: RequestConfig, limit: number): MockRecording['matcher'] {
  const url = String(config.url)
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\/[^/?#]*@/i.test(url)) throw new TypeError('Credential URL')
  if (url.includes('#')) throw new TypeError('Fragment URL')
  const queryStart = url.indexOf('?')
  if (queryStart !== -1) {
    const query = new URLSearchParams(url.slice(queryStart + 1).split('#', 1)[0])
    for (const key of query.keys()) if (sensitive(key)) throw new TypeError('Sensitive URL query')
  }
  const matcher: MockRecording['matcher'] = { url }
  if (config.query) {
    for (const key of Object.keys(config.query)) if (sensitive(key)) throw new TypeError('Sensitive query')
    matcher.query = snapshot(Object.fromEntries(Object.entries(config.query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.filter(item => item !== undefined) : value])), limit) as QueryParams
  }
  if (config.searchParams) {
    for (const key of config.searchParams.keys()) if (sensitive(key)) throw new TypeError('Sensitive searchParams')
    matcher.searchParams = [...config.searchParams]
  }
  // Validate and bound the matcher before forwarding, not after caller mutation.
  return snapshot(matcher, limit) as unknown as MockRecording['matcher']
}

function snapshot(value: unknown, limit: number): MockRecordedData {
  const seen = new Set<object>()
  const encoder = new TextEncoder()
  let remaining = limit
  const charge = (text: string) => {
    if (text.length > remaining) throw new TypeError('Recording too large')
    remaining -= encoder.encode(text).byteLength
    if (remaining < 0) throw new TypeError('Recording too large')
  }
  const visit = (input: unknown, depth: number): MockRecordedData => {
    if (depth > 64) throw new TypeError('Recording too deep')
    if (input === null || typeof input === 'boolean') { charge(String(input)); return input }
    if (typeof input === 'string') {
      if (input.length > remaining) throw new TypeError('Recording too large')
      charge(JSON.stringify(input)); return input
    }
    if (typeof input === 'number' && Number.isFinite(input) && !Object.is(input, -0)) { charge(String(input)); return input }
    if (typeof input !== 'object' || seen.has(input)) throw new TypeError('Non-JSON recording')
    const array = Array.isArray(input)
    if (!array && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
      throw new TypeError('Non-JSON recording')
    }
    if (Object.getOwnPropertySymbols(input).length) throw new TypeError('Symbol recording')
    seen.add(input)
    charge('[]')
    const result: MockRecordedData[] | Record<string, MockRecordedData> = array ? [] : Object.create(null)
    const keys = Object.keys(input)
    if (keys.length > remaining / 2) throw new TypeError('Recording too large')
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!
      if (key.length > remaining) throw new TypeError('Recording too large')
      if (!('value' in descriptor)) throw new TypeError('Accessor recording')
      if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new TypeError('Non-JSON array')
      charge(',')
      if (!array) charge(`${JSON.stringify(key)}:`)
      const item = sensitive(key) ? '[REDACTED]' : descriptor.value
      const copied = visit(item, depth + 1)
      if (array) (result as MockRecordedData[]).push(copied)
      else (result as Record<string, MockRecordedData>)[key] = copied
    }
    if (array && (result as MockRecordedData[]).length !== (input as unknown[]).length) throw new TypeError('Sparse recording')
    seen.delete(input)
    return result
  }
  return visit(value, 0)
}

function literal(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
