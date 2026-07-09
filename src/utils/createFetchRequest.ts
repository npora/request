import type { QueryParams, RequestConfig } from '../types'
import { createTimeoutSignal } from './createTimeoutSignal'

export interface FetchRequest {
  url: string
  init: RequestInit
  clear: () => void
}

export function createFetchRequest(config: RequestConfig): FetchRequest {
  const headers = new Headers(config.headers)
  const body = createBody(config, headers)
  const timeoutSignal = createTimeoutSignal(config.signal, config.timeout)

  return {
    url: createURL(config),
    init: {
      method: config.method ?? 'GET',
      headers,
      body,
      signal: timeoutSignal.signal
    },
    clear: timeoutSignal.clear
  }
}

function createURL(config: RequestConfig): string {
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

  Object.entries(query).forEach(([key, value]) => {
    appendQuery(params, key, value)
  })

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
    value.forEach(item => appendQuery(params, key, item))
    return
  }

  params.append(key, String(value))
}

function createBody(config: RequestConfig, headers: Headers): BodyInit | undefined {
  if (config.json !== undefined) {
    setContentType(headers, 'application/json')
    return JSON.stringify(config.json)
  }

  if (config.form !== undefined) {
    setContentType(headers, 'application/x-www-form-urlencoded;charset=UTF-8')
    return createURLSearchParams(config.form)
  }

  if (config.formData !== undefined) {
    if (config.formData instanceof FormData) {
      return config.formData
    }

    const formData = new FormData()

    Object.entries(config.formData).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        formData.append(key, String(value))
      }
    })

    return formData
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

function createURLSearchParams(
  form: URLSearchParams | Record<string, QueryParams[string]>
): URLSearchParams {
  if (form instanceof URLSearchParams) {
    return form
  }

  const params = new URLSearchParams()

  Object.entries(form).forEach(([key, value]) => {
    appendQuery(params, key, value)
  })

  return params
}

function setContentType(headers: Headers, value: string): void {
  if (!headers.has('content-type')) {
    headers.set('content-type', value)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}
