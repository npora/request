import type { QueryParams, RequestConfig } from '../types'
import { createTimeoutSignal } from './createTimeoutSignal'

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
  const body = buildBody(config, headers)
  const timeoutSignal = createTimeoutSignal(config.signal, config.timeout)

  return {
    url: buildURL(config),
    init: {
      method: config.method ?? 'GET',
      headers,
      body,
      signal: timeoutSignal.signal
    },
    clear: timeoutSignal.clear
  }
}

function buildURL(config: RequestConfig): string {
  const baseURL = config.baseURL ?? ''
  const url = `${baseURL}${config.url}`

  if (!config.query) {
    return url
  }

  const query = stringifyQuery(config.query)

  if (!query) {
    return url
  }

  return url.includes('?') ? `${url}&${query}` : `${url}?${query}`
}

function stringifyQuery(query: QueryParams): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    appendQuery(params, key, value)
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
      appendQuery(params, key, item)
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
    return buildFormData(config.formData)
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
  if (form instanceof URLSearchParams) {
    return form
  }

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(form)) {
    appendQuery(params, key, value)
  }

  return params
}

function buildFormData(
  input: FormData | Record<string, unknown>
): FormData {
  if (input instanceof FormData) {
    return input
  }

  const formData = new FormData()

  for (const [key, value] of Object.entries(input)) {
    appendFormDataValue(formData, key, value)
  }

  return formData
}

function appendFormDataValue(
  formData: FormData,
  key: string,
  value: unknown
): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormDataValue(formData, key, item)
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
