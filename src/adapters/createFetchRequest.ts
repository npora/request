import type { FormDataObject, QueryParams, RequestConfig } from '../types'
import { createTimeoutSignal } from '../utils'

export interface FetchRequest {
  url: string
  init: RequestInit
  clear: () => void
  getAbortReason: () => unknown
}

export function createFetchRequest(config: RequestConfig): FetchRequest {
  const url = createURL(config)
  const headers = createHeaders(config)
  const body = createBody(config, headers)
  const timeoutSignal = createTimeoutSignal(config.signal, config.timeout)

  const init: RequestInit = {
    method: config.method ?? 'GET',
    headers,
    body,
    signal: timeoutSignal.signal,
    credentials: config.credentials,
    mode: config.mode,
    cache: config.cache
  }

  return {
    url,
    init,
    clear: timeoutSignal.clear,
    getAbortReason: timeoutSignal.getReason
  }
}

/**
 * 创建完整请求地址。
 */
function createURL(config: RequestConfig): string {
  const baseURL = config.baseURL ?? ''
  const url = `${baseURL}${config.url}`

  if (!config.query) {
    return url
  }

  const queryString = stringifyQuery(config.query)

  if (!queryString) {
    return url
  }

  return url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`
}

function stringifyQuery(query: QueryParams): string {
  const searchParams = new URLSearchParams()

  Object.entries(query).forEach(([key, value]) => {
    appendSearchParam(searchParams, key, value)
  })

  return searchParams.toString()
}

function appendSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value: QueryParams[string]
): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    value.forEach(item => {
      appendSearchParam(searchParams, key, item)
    })

    return
  }

  searchParams.append(key, String(value))
}

function createHeaders(config: RequestConfig): Headers {
  return new Headers(config.headers)
}

function createBody(config: RequestConfig, headers: Headers): BodyInit | undefined {
  if (config.json !== undefined) {
    setContentTypeIfNeeded(headers, 'application/json')
    return JSON.stringify(config.json)
  }

  if (config.formData !== undefined) {
    return createFormDataBody(config.formData)
  }

  if (config.form !== undefined) {
    setContentTypeIfNeeded(
      headers,
      'application/x-www-form-urlencoded;charset=UTF-8'
    )

    return createURLSearchParams(config.form)
  }

  if (config.body === null || config.body === undefined) {
    return undefined
  }

  if (isPlainObject(config.body)) {
    setContentTypeIfNeeded(headers, 'application/json')
    return JSON.stringify(config.body)
  }

  return config.body
}

function createFormDataBody(formData: FormData | FormDataObject): FormData {
  if (formData instanceof FormData) {
    return formData
  }

  const result = new FormData()

  Object.entries(formData).forEach(([key, value]) => {
    appendFormDataValue(result, key, value)
  })

  return result
}

function appendFormDataValue(
  formData: FormData,
  key: string,
  value: FormDataObject[string]
): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    value.forEach(item => {
      appendFormDataValue(formData, key, item)
    })

    return
  }

  if (value instanceof Blob) {
    formData.append(key, value)
    return
  }

  formData.append(key, String(value))
}

function createURLSearchParams(
  form: URLSearchParams | RequestConfig['form']
): URLSearchParams {
  if (form instanceof URLSearchParams) {
    return form
  }

  const result = new URLSearchParams()

  if (!form) {
    return result
  }

  Object.entries(form).forEach(([key, value]) => {
    appendSearchParam(result, key, value)
  })

  return result
}

function setContentTypeIfNeeded(headers: Headers, contentType: string): void {
  if (!headers.has('content-type')) {
    headers.set('content-type', contentType)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}
