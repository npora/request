import type { RequestConfig } from '../types'
import { isURLSearchParams } from '../utils/isURLSearchParams'

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

    if (defaults.fetchOptions || config.fetchOptions) {
      result.fetchOptions = this.mergeFetchOptions(
        defaults.fetchOptions,
        config.fetchOptions
      )
    }

    if (defaults.headers || config.headers) {
      result.headers = this.mergeHeaders(
        defaults.headers,
        config.headers
      )
    }

    if (
      defaults.query ||
      config.query ||
      defaults.searchParams ||
      config.searchParams
    ) {
      Object.assign(
        result,
        this.mergeQueryConfig(defaults, config)
      )
    }

    if (defaults.extensions || config.extensions) {
      result.extensions = this.mergeExtensions(
        defaults.extensions,
        config.extensions
      )
    }

    if (
      this.hasBodyConfig(defaults) ||
      this.hasBodyConfig(config)
    ) {
      Object.assign(
        result,
        this.mergeBodyConfig(defaults, config)
      )
    }

    return result
  }

  private static mergeQueryConfig(
    defaults: Partial<RequestConfig>,
    config: Partial<RequestConfig>
  ): Pick<RequestConfig, 'query' | 'searchParams'> {
    if (config.searchParams !== undefined) {
      return {
        query: config.query,
        searchParams:
          isURLSearchParams(config.searchParams)
            ? new URLSearchParams(config.searchParams)
            : config.searchParams
      }
    }

    if (config.query !== undefined) {
      return {
        query: this.mergeObject(
          defaults.searchParams ? undefined : defaults.query,
          config.query
        ),
        searchParams: undefined
      }
    }

    return {
      query: defaults.query
        ? { ...defaults.query }
        : undefined,
      searchParams:
        isURLSearchParams(defaults.searchParams)
          ? new URLSearchParams(defaults.searchParams)
          : defaults.searchParams
    }
  }

  private static mergeFetchOptions(
    defaults?: RequestConfig['fetchOptions'],
    options?: RequestConfig['fetchOptions']
  ): RequestConfig['fetchOptions'] {
    if (!defaults && !options) {
      return undefined
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
    headers?: HeadersInit
  ): HeadersInit | undefined {
    if (!defaults && !headers) {
      return undefined
    }

    const result: Record<string, string> = {}

    this.appendHeaders(result, defaults)
    this.appendHeaders(result, headers)

    return result
  }

  private static appendHeaders(
    result: Record<string, string>,
    headers?: HeadersInit
  ): void {
    if (!headers) {
      return
    }

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
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
        Object.prototype.hasOwnProperty.call(headers, key)
      ) {
        setHeader(
          result,
          key.toLowerCase(),
          String(headers[key])
        )
      }
    }
  }

  private static mergeObject<T extends object>(
    defaults?: T,
    value?: T
  ): T | undefined {
    if (!defaults && !value) {
      return undefined
    }

    return {
      ...defaults,
      ...value
    } as T
  }

  private static mergeExtensions(
    defaults?: RequestConfig['extensions'],
    extensions?: RequestConfig['extensions']
  ): RequestConfig['extensions'] {
    if (!defaults && !extensions) {
      return undefined
    }

    const result: Record<string, unknown> = {
      ...defaults,
      ...extensions
    }
    for (const key in extensions) {
      if (
        !Object.prototype.hasOwnProperty.call(
          extensions,
          key
        )
      ) {
        continue
      }

      const defaultValue = (defaults as Record<string, unknown> | undefined)?.[
        key
      ]
      const requestValue = (
        extensions as Record<string, unknown> | undefined
      )?.[key]

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
      config.body !== undefined ||
      config.json !== undefined ||
      config.form !== undefined ||
      config.formData !== undefined ||
      Object.prototype.hasOwnProperty.call(config, 'body') ||
      Object.prototype.hasOwnProperty.call(config, 'json') ||
      Object.prototype.hasOwnProperty.call(config, 'form') ||
      Object.prototype.hasOwnProperty.call(config, 'formData')
    )
  }

  private static mergeBodyConfig(
    defaults: Partial<RequestConfig>,
    config: Partial<RequestConfig>
  ): Pick<RequestConfig, 'body' | 'json' | 'form' | 'formData'> {
    const keys = [
      'body',
      'json',
      'form',
      'formData'
    ] as const

    const hasRequestBodyConfig = keys.some(key => {
      return Object.prototype.hasOwnProperty.call(config, key)
    })

    if (!hasRequestBodyConfig) {
      return {
        body: defaults.body,
        json: defaults.json,
        form: defaults.form,
        formData: defaults.formData
      }
    }

    return {
      body: config.body,
      json: config.json,
      form: config.form,
      formData: config.formData
    }
  }
}

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
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
