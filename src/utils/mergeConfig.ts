import type { RequestConfig } from '../types'

/**
 * 合并请求配置。
 *
 * 用于将 Client 默认配置和单次请求配置合并成最终请求配置。
 */
export function mergeConfig(
  defaults: Partial<RequestConfig>,
  config: RequestConfig
): RequestConfig {
  return {
    ...defaults,
    ...config,
    headers: mergeHeaders(defaults.headers, config.headers)
  }
}

/**
 * 合并请求头。
 */
function mergeHeaders(
  defaults?: HeadersInit,
  headers?: HeadersInit
): HeadersInit | undefined {
  if (!defaults && !headers) {
    return undefined
  }

  return {
    ...normalizeHeaders(defaults),
    ...normalizeHeaders(headers)
  }
}

/**
 * 标准化 Headers。
 */
function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {}
  }

  if (headers instanceof Headers) {
    const result: Record<string, string> = {}

    headers.forEach((value, key) => {
      result[key] = value
    })

    return result
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return headers as Record<string, string>
}
