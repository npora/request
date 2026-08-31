import type { QueryParams, RequestConfig } from '../types'
import { RequestError } from '../errors'
import { createTimeoutSignal } from './createTimeoutSignal'
import { hasOwnProperty } from './hasOwnProperty'
import { isURLSearchParams } from './isURLSearchParams'
import { isArrayBuffer, isBlob } from './isBinaryBody'
import { isFormData } from './isFormData'
import { isReadableStream } from './isReadableStream'
import { getRequestForBody } from './isRequest'

const RESPONSE_ACCEPT = {
  json: 'application/json',
  text: 'text/*',
  blob: '*/*',
  arrayBuffer: '*/*',
  bytes: '*/*',
  formData: 'multipart/form-data',
  stream: '*/*',
  sse: 'text/event-stream',
  ndjson: 'application/x-ndjson, application/ndjson'
} satisfies Record<
  NonNullable<RequestConfig['responseType']>,
  string
>

const URL_REFERENCE = /^([^?#]*)(?:\?([^#]*))?(#.*)?$/

export interface BuiltRequest {
  url: string
  input?: Request
  useNativeInput?: boolean
  init: RequestInit
  clear: () => void
  bodyError?: { current?: RequestError }
}

/**
 * Build a Fetch-compatible request from RequestConfig.
 */
export function buildRequest(config: RequestConfig): BuiltRequest {
  const headers = new Headers(config.headers)

  return buildRequestWithHeaders(config, headers)
}

/**
 * Internal fast path for a Headers instance already created by validation.
 */
export function buildRequestWithHeaders(
  config: RequestConfig,
  headers: Headers
): BuiltRequest {
  setAccept(headers, config.responseType)
  let body = buildBody(config, headers)
  validateRequestBodySize(body, config)
  const bodyError: { current?: RequestError } = {}
  const originalBody = body
  body = limitStreamingRequestBody(body, config, bodyError)
  const url = buildURL(config)
  const input = resolveNativeRequestInput(
    config,
    body,
    url,
    config.method
  )
  const init: RequestInit = {
    ...config.fetchOptions,
    method: config.method ?? 'GET',
    headers,
    signal: config.signal
  }

  if (!input) {
    init.body = body

    if (body && isReadableStream(body)) {
      (init as RequestInit & { duplex: 'half' }).duplex = 'half'
    }
  }

  const timeoutEnabled = Boolean(
    config.timeout && config.timeout > 0
  )
  const timeoutSignal = timeoutEnabled
    ? createTimeoutSignal(config.signal, config.timeout)
    : undefined

  if (timeoutSignal) {
    init.signal = timeoutSignal.signal
  }

  const useNativeInput = input
    ? canUseNativeInput(input, init, config.fetchOptions)
    : false

  return {
    url,
    input,
    useNativeInput,
    init,
    clear: timeoutSignal?.clear ?? noop,
    bodyError: body === originalBody ? undefined : bodyError
  }
}

function canUseNativeInput(
  input: Request,
  init: RequestInit,
  fetchOptions: RequestConfig['fetchOptions']
): boolean {
  if (
    init.method !== input.method ||
    init.signal !== input.signal ||
    !headersEqual(input.headers, init.headers)
  ) {
    return false
  }

  return fetchOptions === undefined || (
    fetchOptions.cache === input.cache &&
    fetchOptions.credentials === input.credentials &&
    fetchOptions.integrity === input.integrity &&
    fetchOptions.keepalive === input.keepalive &&
    fetchOptions.mode === input.mode &&
    fetchOptions.redirect === input.redirect &&
    fetchOptions.referrer === input.referrer &&
    fetchOptions.referrerPolicy === input.referrerPolicy &&
    Reflect.ownKeys(fetchOptions).length === 8
  )
}

function headersEqual(
  left: Headers,
  right: HeadersInit | undefined
): boolean {
  const expected = new Headers(right)

  if ([...left].length !== [...expected].length) {
    return false
  }

  for (const [key, value] of left) {
    if (expected.get(key) !== value) {
      return false
    }
  }

  return true
}

function resolveNativeRequestInput(
  config: RequestConfig,
  body: BodyInit | undefined,
  url: string,
  method: RequestConfig['method']
): Request | undefined {
  const input = getRequestForBody(config, body)

  return input?.url === url && input.method === (method ?? 'GET')
    ? input
    : undefined
}

function setAccept(
  headers: Headers,
  responseType: RequestConfig['responseType']
): void {
  if (!responseType || headers.has('accept')) {
    return
  }

  headers.set('accept', RESPONSE_ACCEPT[responseType])
}

function buildURL(config: RequestConfig): string {
  const url = joinURL(config.baseURL, String(config.url))

  if (!config.query && !config.searchParams) {
    return url
  }

  const query = serializeQuery(config)

  if (!query) {
    return url
  }

  const hashIndex = url.indexOf('#')
  const target = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = target.includes('?') ? '&' : '?'

  return `${target}${separator}${query}${hash}`
}

export function serializeQuery(config: RequestConfig): string {
  if (config.searchParams) {
    return config.searchParams.toString()
  }

  const query = config.query as QueryParams

  if (!config.querySerializer) {
    return stringifyQuery(query)
  }

  let serialized: unknown

  try {
    serialized = config.querySerializer(query)
  } catch (error) {
    throw new RequestError('Request query serialization failed', {
      code: 'CONFIG_ERROR',
      config,
      cause: error
    })
  }

  if (typeof serialized !== 'string') {
    throw new RequestError(
      'Request querySerializer must return a string',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return serialized.startsWith('?')
    ? serialized.slice(1)
    : serialized
}

function joinURL(baseURL: string | undefined, url: string): string {
  if (!baseURL || isAbsoluteURL(url)) {
    return url
  }

  if (!url) {
    return baseURL
  }

  const baseHasSuffix = baseURL.includes('?') || baseURL.includes('#')
  const firstInputCharacter = url.charCodeAt(0)

  if (
    !baseHasSuffix &&
    firstInputCharacter !== 63 &&
    firstInputCharacter !== 35
  ) {
    return joinURLPath(baseURL, url)
  }

  const base = URL_REFERENCE.exec(baseURL)!
  const input = URL_REFERENCE.exec(url)!
  const path = joinURLPath(base[1]!, input[1]!)
  const baseQuery = base[2] ?? ''
  const inputQuery = input[2] ?? ''
  const query = baseQuery && inputQuery
    ? `${baseQuery}&${inputQuery}`
    : baseQuery || inputQuery
  const hash = input[3] || base[3] || ''

  return `${path}${query ? `?${query}` : ''}${hash}`
}

function joinURLPath(baseURL: string, url: string): string {
  if (!url) {
    return baseURL
  }

  let baseEnd = baseURL.length
  let urlStart = 0

  while (
    baseEnd > 0 &&
    baseURL.charCodeAt(baseEnd - 1) === 47
  ) {
    baseEnd -= 1
  }

  while (
    urlStart < url.length &&
    url.charCodeAt(urlStart) === 47
  ) {
    urlStart += 1
  }

  return `${baseURL.slice(0, baseEnd)}/${url.slice(urlStart)}`
}

export function isAbsoluteURL(url: string): boolean {
  if (url.startsWith('//')) {
    return true
  }

  const colon = url.indexOf(':')

  if (colon <= 0) {
    return false
  }

  return /^[a-z][a-z\d+\-.]*$/i.test(
    url.slice(0, colon)
  )
}

function stringifyQuery(query: QueryParams): string {
  const params = new URLSearchParams()

  for (const key in query) {
    if (
      hasOwnProperty.call(query, key)
    ) {
      appendQuery(params, key, query[key])
    }
  }

  return params.toString()
}

function appendQuery(
  params: URLSearchParams,
  key: string,
  value: QueryParams[string]
): void {
  if (value === undefined) {
    return
  }

  if (value === null) {
    params.append(key, '')
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined) {
        params.append(key, item === null ? '' : String(item))
      }
    }

    return
  }

  params.append(key, String(value))
}

function buildBody(
  config: RequestConfig,
  headers: Headers
): BodyInit | undefined {
  if (config.json !== undefined) {
    setContentType(headers, 'application/json')
    return stringifyJson(config.json, config)
  }

  if (config.form !== undefined) {
    setContentType(
      headers,
      'application/x-www-form-urlencoded;charset=UTF-8'
    )

    return buildURLSearchParams(config.form)
  }

  if (config.formData !== undefined) {
    return buildFormData(
      config.formData,
      config.maxFormDataDepth
    )
  }

  if (config.body === null || config.body === undefined) {
    return undefined
  }

  if (isPlainObject(config.body)) {
    setContentType(headers, 'application/json')
    return stringifyJson(config.body, config)
  }

  return config.body
}

function stringifyJson(
  value: unknown,
  config: RequestConfig
): string {
  const serialized = config.stringifyJson
    ? config.stringifyJson(value)
    : JSON.stringify(value)

  if (typeof serialized !== 'string') {
    throw new TypeError('Request JSON stringifier must return a string')
  }

  return serialized
}

function buildURLSearchParams(
  form: URLSearchParams | Record<string, QueryParams[string]>
): URLSearchParams {
  if (isURLSearchParams(form)) {
    return form
  }

  const params = new URLSearchParams()

  for (const key in form) {
    if (
      hasOwnProperty.call(form, key)
    ) {
      appendQuery(params, key, form[key])
    }
  }

  return params
}

function buildFormData(
  input: FormData | Record<string, unknown>,
  maxDepth = 32
): FormData {
  if (isFormData(input)) {
    return input
  }

  const formData = new FormData()
  const ancestors = new WeakSet<object>()

  for (const key in input) {
    if (
      hasOwnProperty.call(input, key)
    ) {
      appendFormDataValue(
        formData,
        key,
        input[key],
        0,
        maxDepth,
        ancestors
      )
    }
  }

  return formData
}

function appendFormDataValue(
  formData: FormData,
  key: string,
  value: unknown,
  depth: number,
  maxDepth: number,
  ancestors: WeakSet<object>
): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(
        'FormData arrays cannot contain circular references'
      )
    }

    const nextDepth = depth + 1

    if (nextDepth > maxDepth) {
      throw new RangeError(
        `FormData array depth exceeds maxFormDataDepth ${maxDepth}`
      )
    }

    ancestors.add(value)

    try {
      for (const item of value) {
        appendFormDataValue(
          formData,
          key,
          item,
          nextDepth,
          maxDepth,
          ancestors
        )
      }
    } finally {
      ancestors.delete(value)
    }

    return
  }

  if (isBlob(value)) {
    formData.append(key, value)
    return
  }

  formData.append(key, String(value))
}

function setContentType(headers: Headers, value: string): void {
  if (!headers.has('content-type')) {
    headers.set('content-type', value)
  }
}

function validateRequestBodySize(
  body: BodyInit | undefined,
  config: RequestConfig
): void {
  const maxSize = config.maxRequestSize

  if (!Number.isFinite(maxSize) || body === undefined) {
    return
  }

  const size = getRequestBodySize(body)

  if (
    size !== undefined &&
    size > (maxSize ?? Number.POSITIVE_INFINITY)
  ) {
    throw new RequestError(
      `Request body exceeds maxRequestSize ${maxSize}`,
      {
        code: 'REQUEST_TOO_LARGE',
        config
      }
    )
  }
}

function getRequestBodySize(body: BodyInit): number | undefined {
  if (typeof body === 'string') {
    return utf8ByteLength(body)
  }

  if (isURLSearchParams(body)) {
    return utf8ByteLength(body.toString())
  }

  if (isBlob(body)) {
    return body.size
  }

  if (isArrayBuffer(body)) {
    return body.byteLength
  }

  if (ArrayBuffer.isView(body)) {
    return body.byteLength
  }

  return undefined
}

function limitStreamingRequestBody(
  body: BodyInit | undefined,
  config: RequestConfig,
  bodyError: { current?: RequestError }
): BodyInit | undefined {
  const maxSize = config.maxRequestSize

  if (!isReadableStream(body) || !Number.isFinite(maxSize)) {
    return body
  }

  const source = body as ReadableStream<Uint8Array<ArrayBufferLike>>
  let reader: ReadableStreamDefaultReader<
    Uint8Array<ArrayBufferLike>
  > | undefined
  let size = 0

  return new ReadableStream<Uint8Array<ArrayBufferLike>>({
    async pull(controller) {
      reader ??= source.getReader()

      try {
        const result = await reader.read()

        if (result.done) {
          reader.releaseLock()
          reader = undefined
          controller.close()
          return
        }

        size += result.value.byteLength

        if (size > (maxSize ?? Number.POSITIVE_INFINITY)) {
          const error = new RequestError(
            `Request body exceeds maxRequestSize ${maxSize}`,
            {
              code: 'REQUEST_TOO_LARGE',
              config
            }
          )
          bodyError.current = error

          void reader.cancel(error).catch(() => {
            // The size error remains authoritative.
          })
          reader.releaseLock()
          reader = undefined

          throw error
        }

        controller.enqueue(result.value)
      } catch (error) {
        if (reader) {
          reader.releaseLock()
          reader = undefined
        }

        throw error
      }
    },
    async cancel(reason) {
      if (reader) {
        try {
          await reader.cancel(reason)
        } finally {
          reader.releaseLock()
          reader = undefined
        }
      } else if (!source.locked) {
        await source.cancel(reason)
      }
    }
  })
}

function utf8ByteLength(value: string): number {
  let bytes = 0

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1)

      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }

  return bytes
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function noop(): void {}
