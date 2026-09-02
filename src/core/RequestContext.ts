import type { NporaResponse, RequestConfig } from '../types'
import { normalizeURL } from '../utils/normalizeURL'

export class RequestContext<T = unknown> {
  public config: RequestConfig

  /** @internal Request input before interceptors and hooks mutate it. */
  public readonly initialConfig: RequestConfig

  public response?: NporaResponse<T>

  /** @internal Candidate used only after retry handling declines another attempt. */
  public fallbackResponse?: NporaResponse<T>

  public error?: unknown

  public readonly startTime: number

  public endTime?: number

  public attempt = 0

  /** @internal Total time spent waiting for rate-limit admission. */
  public rateLimitWaitTime = 0

  /** @internal Whether the rate-limit plugin admitted an attempt. */
  public rateLimitApplied = false

  /** @internal Whether the cache plugin supplied the final response. */
  public cacheHit = false

  constructor(
    config: RequestConfig,
    public readonly preserveRaw = true,
    /** @internal */
    public readonly background = false
  ) {
    this.config = config
    this.initialConfig = cloneRequestConfig(config)
    this.startTime = Date.now()
  }
}

function cloneRequestConfig(config: RequestConfig): RequestConfig {
  try {
    return {
      ...config,
      url: normalizeURL(config.url) ?? config.url,
      extensions: config.extensions
        ? { ...config.extensions }
        : undefined,
      fetchOptions: config.fetchOptions
        ? { ...config.fetchOptions }
        : undefined,
      context: config.context
        ? { ...config.context }
        : undefined,
      headers: config.headers
        ? new Headers(config.headers)
        : undefined,
      query: config.query
        ? { ...config.query }
        : undefined,
      searchParams: config.searchParams
        ? new URLSearchParams(config.searchParams)
        : undefined
    }
  } catch {
    return { ...config }
  }
}
