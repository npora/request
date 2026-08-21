import type { QueryParams, RequestConfig } from '../types'
import { createTimeoutSignal } from './createTimeoutSignal'
import { isURLSearchParams } from './isURLSearchParams'

export interface BuiltRequest {
  url: string
  init: RequestInit
  clear: () => void
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
  const body = buildBody(config, headers)
  const timeoutEnabled = Boolean(
    config.timeout && config.timeout > 0
  )
  const timeoutSignal = timeoutEnabled
    ? createTimeoutSignal(config.signal, config.timeout)
    : undefined

  return {
    url: buildURL(config),
    init: {
      ...config.fetchOptions,
      method: config.method ?? 'GET',
      headers,
      body,
      signal: timeoutSignal?.signal ?? config.signal
    },
    clear: timeoutSignal?.clear ?? noop
  }
}

function buildURL(config: RequestConfig): string {
  const url = joinURL(config.baseURL, config.url)

  if (!config.query && !config.searchParams) {
    return url
  }

  const query = config.searchParams
    ? config.searchParams.toString()
    : stringifyQuery(config.query as QueryParams)

  if (!query) {
    return url
  }

  const hashIndex = url.indexOf('#')
  const target = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = target.includes('?') ? '&' : '?'

  return `${target}${separator}${query}${hash}`
}

function joinURL(baseURL: string | undefined, url: string): string {
  if (!baseURL || isAbsoluteURL(url)) {
    return url
  }

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

function isAbsoluteURL(url: string): boolean {
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
      Object.prototype.hasOwnProperty.call(query, key)
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
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && item !== undefined) {
        params.append(key, String(item))
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
    return JSON.stringify(config.json)
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
    return JSON.stringify(config.body)
  }

  return config.body
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
      Object.prototype.hasOwnProperty.call(form, key)
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
  if (input instanceof FormData) {
    return input
  }

  const formData = new FormData()
  const ancestors = new WeakSet<object>()

  for (const key in input) {
    if (
      Object.prototype.hasOwnProperty.call(input, key)
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

  if (value instanceof Blob) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function noop(): void {}
