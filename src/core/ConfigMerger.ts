import type { RequestConfig } from '../types'
import { hasOwnProperty } from '../utils/hasOwnProperty'
import { isURLSearchParams } from '../utils/isURLSearchParams'
import { isHeaders } from '../utils/isHeaders'

/**
 * Request configuration merger.
 *
 * Responsible for merging client defaults
 * and request specific configuration.
 */
export class ConfigMerger {
  /**
   * Merge request configuration.
   */
  static merge(
    defaults: Partial<RequestConfig>,
    config: RequestConfig
  ): RequestConfig {
    return this.mergeConfig(defaults, config) as RequestConfig
  }

  /**
   * Merge two sets of client defaults.
   */
  static mergeDefaults(
    defaults: Partial<RequestConfig>,
    overrides: Partial<RequestConfig>
  ): Partial<RequestConfig> {
    return this.mergeConfig(defaults, overrides)
  }

  private static mergeConfig(
    defaults: Partial<RequestConfig>,
    config: Partial<RequestConfig>
  ): Partial<RequestConfig> {
    const result: Partial<RequestConfig> = {
      ...defaults,
      ...config
    }

    if (
      hasOwnProperty.call(config, 'validateStatus') &&
      !hasOwnProperty.call(config, 'throwHttpErrors')
    ) {
      result.throwHttpErrors = undefined
    } else if (
      hasOwnProperty.call(config, 'throwHttpErrors') &&
      !hasOwnProperty.call(config, 'validateStatus')
    ) {
      result.validateStatus = undefined
    }

    if (defaults.fetchOptions || config.fetchOptions) {
      result.fetchOptions = this.mergeFetchOptions(
        defaults.fetchOptions,
        config.fetchOptions
      )
    }

    if (isContextObject(config.context)) {
      result.context = {
        ...(isContextObject(defaults.context) ? defaults.context : {}),
        ...config.context
      }
    } else if (isContextObject(defaults.context)) {
      result.context = { ...defaults.context }
    }

    if (
      defaults.headers ||
      config.headers ||
      defaults.removeHeaders ||
      config.removeHeaders
    ) {
      result.headers = this.mergeHeaders(
        defaults.headers,
        config.headers,
        defaults.removeHeaders,
        config.removeHeaders
      )
    }

    if (
      defaults.query ||
      config.query ||
      defaults.searchParams ||
      config.searchParams
    ) {
      this.mergeQueryConfig(result, defaults, config)
    }

    if (defaults.extensions || config.extensions) {
      result.extensions = this.mergeExtensions(
        defaults.extensions,
        config.extensions
      )
    }

    if (this.hasBodyConfig(config)) {
      this.mergeBodyConfig(result, config)
    }

    return result
  }

  private static mergeQueryConfig(
    result: Partial<RequestConfig>,
    defaults: Partial<RequestConfig>,
    config: Partial<RequestConfig>
  ): void {
    if (config.searchParams !== undefined) {
      result.query = config.query
      result.searchParams = isURLSearchParams(config.searchParams)
        ? new URLSearchParams(config.searchParams)
        : config.searchParams
      return
    }

    if (config.query !== undefined) {
      result.query = this.mergeObject(
        defaults.searchParams ? undefined : defaults.query,
        config.query
      )
      result.searchParams = undefined
      return
    }

    result.query = defaults.query
      ? { ...defaults.query }
      : undefined
    result.searchParams = isURLSearchParams(defaults.searchParams)
      ? new URLSearchParams(defaults.searchParams)
      : defaults.searchParams
  }

  private static mergeFetchOptions(
    defaults?: RequestConfig['fetchOptions'],
    options?: RequestConfig['fetchOptions']
  ): RequestConfig['fetchOptions'] {
    return {
      ...defaults,
      ...options
    }
  }

  /**
   * Merge request headers.
   */
  private static mergeHeaders(
    defaults?: HeadersInit,
    headers?: HeadersInit,
    defaultRemovals?: readonly string[],
    removals?: readonly string[]
  ): HeadersInit {
    const result: Record<string, string> = {}

    if (defaults) {
      this.appendHeaders(result, defaults)
    }
    if (Array.isArray(defaultRemovals)) {
      this.removeHeaders(result, defaultRemovals)
    }
    if (headers) {
      this.appendHeaders(result, headers)
    }
    if (Array.isArray(removals)) {
      this.removeHeaders(result, removals)
    }

    return result
  }

  private static appendHeaders(
    result: Record<string, string>,
    headers: HeadersInit
  ): void {
    if (isHeaders(headers)) {
      Headers.prototype.forEach.call(headers, (value, key) => {
        setHeader(result, key, value)
      })

      return
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        setHeader(
          result,
          key.toLowerCase(),
          String(value)
        )
      }

      return
    }

    for (const key in headers) {
      if (
        hasOwnProperty.call(headers, key)
      ) {
        setHeader(
          result,
          key.toLowerCase(),
          String(headers[key])
        )
      }
    }
  }

  private static removeHeaders(
    headers: Record<string, string>,
    names: readonly unknown[]
  ): void {
    for (const name of names) {
      if (typeof name === 'string') {
        delete headers[name.toLowerCase()]
      }
    }
  }

  private static mergeObject<T extends object>(
    defaults: T | undefined,
    value: T
  ): T {
    return {
      ...defaults,
      ...value
    } as T
  }

  private static mergeExtensions(
    defaults?: RequestConfig['extensions'],
    extensions?: RequestConfig['extensions']
  ): RequestConfig['extensions'] {
    if (!defaults) {
      return extensions
        ? { ...extensions }
        : undefined
    }

    if (!extensions) {
      return { ...defaults }
    }

    const result: Record<string, unknown> = {
      ...defaults,
      ...extensions
    }
    for (const key in extensions) {
      if (
        !hasOwnProperty.call(
          extensions,
          key
        )
      ) {
        continue
      }

      const defaultValue = (defaults as Record<string, unknown>)[key]
      const requestValue = (extensions as Record<string, unknown>)[key]

      if (
        isPlainObject(defaultValue) &&
        isPlainObject(requestValue)
      ) {
        result[key] = {
          ...defaultValue,
          ...requestValue
        }
      }
    }

    return result
  }

  private static hasBodyConfig(
    config: Partial<RequestConfig>
  ): boolean {
    return (
      hasOwnProperty.call(config, 'body') ||
      hasOwnProperty.call(config, 'json') ||
      hasOwnProperty.call(config, 'form') ||
      hasOwnProperty.call(config, 'formData')
    )
  }

  private static mergeBodyConfig(
    result: Partial<RequestConfig>,
    config: Partial<RequestConfig>
  ): void {
    result.body = config.body
    result.json = config.json
    result.form = config.form
    result.formData = config.formData
  }
}

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function isContextObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setHeader(
  headers: Record<string, string>,
  key: string,
  value: string
): void {
  if (key === '__proto__') {
    Object.defineProperty(headers, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    })

    return
  }

  headers[key] = value
}
