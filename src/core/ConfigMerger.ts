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
    return {
      ...defaults,
      ...config,

      headers: this.mergeHeaders(
        defaults.headers,
        config.headers
      )
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

  /**
   * Normalize headers.
   */
  private static normalizeHeaders(
    headers?: HeadersInit
  ): Record<string, string> {
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
}
