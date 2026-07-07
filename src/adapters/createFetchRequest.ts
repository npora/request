import type { RequestConfig } from '../types'

/**
 * 创建 Fetch 请求参数。
 *
 * 负责将 Nova Request 的 RequestConfig
 * 转换为 Fetch API 可识别的 url 和 init。
 */
export function createFetchRequest(config: RequestConfig): {
  url: string
  init: RequestInit
} {
  const url = createURL(config)

  const init: RequestInit = {
    method: config.method ?? 'GET',
    headers: config.headers,
    body: createBody(config),
    signal: config.signal,
    credentials: config.credentials,
    mode: config.mode,
    cache: config.cache
  }

  return {
    url,
    init
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

  const searchParams = new URLSearchParams()

  Object.entries(config.query).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return
    }

    if (Array.isArray(value)) {
      value.forEach(item => {
        if (item !== null && item !== undefined) {
          searchParams.append(key, String(item))
        }
      })

      return
    }

    searchParams.append(key, String(value))
  })

  const queryString = searchParams.toString()

  if (!queryString) {
    return url
  }

  return url.includes('?')
    ? `${url}&${queryString}`
    : `${url}?${queryString}`
}

/**
 * 创建请求体。
 */
function createBody(config: RequestConfig): BodyInit | undefined {
  if (config.body === null || config.body === undefined) {
    return undefined
  }

  if (isPlainObject(config.body)) {
    return JSON.stringify(config.body)
  }

  return config.body
}

/**
 * 判断是否为普通对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}