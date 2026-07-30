import type { RequestConfig } from '../types'

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
    return {
      ...defaults,
      ...config,

      fetchOptions: this.mergeFetchOptions(
        defaults.fetchOptions,
        config.fetchOptions
      ),

      headers: this.mergeHeaders(
        defaults.headers,
        config.headers
      ),

      query: this.mergeObject(
        defaults.query,
        config.query
      ),

      extensions: this.mergeExtensions(
        defaults.extensions,
        config.extensions
      ),

      // Compatibility fields are supplied through built-in plugin module
      // augmentation and remain supported during the v0.x migration.
      retry: this.mergeRetry(
        defaults.retry,
        config.retry
      ),

      cache: this.mergeObject(
        defaults.cache,
        config.cache
      ),

      auth: this.mergeObject(
        defaults.auth,
        config.auth
      ),

      logger: this.mergeObject(
        defaults.logger,
        config.logger
      ),

      upload: this.mergeObject(
        defaults.upload,
        config.upload
      ),

      download: this.mergeObject(
        defaults.download,
        config.download
      ),

      ...this.mergeBodyConfig(defaults, config)
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

    return {
      ...this.normalizeHeaders(defaults),
      ...this.normalizeHeaders(headers)
    }
  }

  private static normalizeHeaders(
    headers?: HeadersInit
  ): Record<string, string> {
    if (!headers) {
      return {}
    }

    const entries: [string, string][] = []

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        entries.push([key, value])
      })
    } else if (Array.isArray(headers)) {
      entries.push(...headers)
    } else {
      entries.push(...Object.entries(headers))
    }

    return Object.fromEntries(
      entries.map(([key, value]) => [
        key.toLowerCase(),
        String(value)
      ])
    )
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

  private static mergeRetry(
    defaults?: RequestConfig['retry'],
    retry?: RequestConfig['retry']
  ): RequestConfig['retry'] {
    if (retry === undefined) {
      return defaults
    }

    if (typeof retry === 'number') {
      return retry
    }

    const normalizedDefaults =
      typeof defaults === 'number'
        ? {
            retries: defaults
          }
        : defaults

    return {
      ...normalizedDefaults,
      ...retry
    }
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
    const keys = new Set([
      ...Object.keys(defaults ?? {}),
      ...Object.keys(extensions ?? {})
    ])

    for (const key of keys) {
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
