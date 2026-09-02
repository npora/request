import type { RequestConfig } from '../types'
import { hasOwnProperty } from '../utils/hasOwnProperty'
import { isURLSearchParams } from '../utils/isURLSearchParams'
import { isHeaders } from '../utils/isHeaders'
import { getTrustedDefaults } from './trustedDefaults'

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
    const trustedDefaults = getTrustedDefaults(defaults)

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

    if (result.fetchOptions) {
      result.fetchOptions = this.mergeFetchOptions(
        trustedDefaults
          ? trustedDefaults.fetchOptions
          : ownValue(defaults, 'fetchOptions'),
        ownValue(config, 'fetchOptions')
      )
    }

    if (hasOwnProperty.call(config, 'context')) {
      if (isContextObject(config.context)) {
        const defaultContext = trustedDefaults
          ? trustedDefaults.context
          : ownValue(defaults, 'context')

        result.context = {
          ...(isContextObject(defaultContext) ? defaultContext : {}),
          ...config.context
        }
      }
    } else {
      const defaultContext = trustedDefaults
        ? trustedDefaults.context
        : ownValue(defaults, 'context')

      if (isContextObject(defaultContext)) {
        result.context = { ...defaultContext }
      }
    }

    if (result.headers || result.removeHeaders) {
      result.headers = this.mergeHeaders(
        trustedDefaults
          ? trustedDefaults.headers
          : ownValue(defaults, 'headers'),
        ownValue(config, 'headers'),
        trustedDefaults
          ? trustedDefaults.removeHeaders
          : ownValue(defaults, 'removeHeaders'),
        ownValue(config, 'removeHeaders')
      )
    }

    if (result.query || result.searchParams) {
      this.mergeQueryConfig(
        result,
        trustedDefaults
          ? trustedDefaults.query
          : ownValue(defaults, 'query'),
        ownValue(config, 'query'),
        trustedDefaults
          ? trustedDefaults.searchParams
          : ownValue(defaults, 'searchParams'),
        ownValue(config, 'searchParams')
      )
    }

    if (result.extensions) {
      result.extensions = this.mergeExtensions(
        trustedDefaults
          ? trustedDefaults.extensions
          : ownValue(defaults, 'extensions'),
        ownValue(config, 'extensions')
      )
    }

    if (
      (
        trustedDefaults
          ? trustedDefaults.hasBodyConfig
          : this.hasBodyConfig(defaults)
      ) ||
      this.hasBodyValue(result)
    ) {
      if (this.hasBodyConfig(config)) {
        this.mergeBodyConfig(result, config)
      }
    }

    return result
  }

  private static mergeQueryConfig(
    result: Partial<RequestConfig>,
    defaultQuery: RequestConfig['query'],
    query: RequestConfig['query'],
    defaultSearchParams: RequestConfig['searchParams'],
    searchParams: RequestConfig['searchParams']
  ): void {
    if (searchParams !== undefined) {
      result.query = query
      result.searchParams = isURLSearchParams(searchParams)
        ? new URLSearchParams(searchParams)
        : searchParams
      return
    }

    if (query !== undefined) {
      if (!isRecordObject(query)) {
        result.query = query
        result.searchParams = undefined
        return
      }

      result.query = this.mergeObject(
        defaultSearchParams
          ? undefined
          : isRecordObject(defaultQuery)
          ? defaultQuery
          : undefined,
        query
      )
      result.searchParams = undefined
      return
    }

    result.query = defaultQuery
      ? isRecordObject(defaultQuery)
        ? { ...defaultQuery }
        : defaultQuery
      : undefined
    result.searchParams = isURLSearchParams(defaultSearchParams)
      ? new URLSearchParams(defaultSearchParams)
      : defaultSearchParams
  }

  private static mergeFetchOptions(
    defaults?: RequestConfig['fetchOptions'],
    options?: RequestConfig['fetchOptions']
  ): RequestConfig['fetchOptions'] {
    if (options !== undefined && !isRecordObject(options)) {
      return options
    }

    if (defaults !== undefined && !isRecordObject(defaults)) {
      return options ?? defaults
    }

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
    if (extensions !== undefined && !isRecordObject(extensions)) {
      return extensions
    }

    if (defaults !== undefined && !isRecordObject(defaults)) {
      return extensions ?? defaults
    }

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

      const defaultValue = hasOwnProperty.call(defaults, key)
        ? (defaults as Record<string, unknown>)[key]
        : undefined
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

  private static hasBodyValue(
    config: Partial<RequestConfig>
  ): boolean {
    return (
      config.body !== undefined ||
      config.json !== undefined ||
      config.form !== undefined ||
      config.formData !== undefined
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

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ownValue<
  T extends object,
  K extends keyof T
>(value: T, key: K): T[K] | undefined {
  return hasOwnProperty.call(value, key)
    ? value[key]
    : undefined
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
