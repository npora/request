import type { NporaResponse, RequestConfig } from '../types'

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
      extensions: config.extensions
        ? { ...config.extensions }
        : undefined,
      fetchOptions: config.fetchOptions
        ? { ...config.fetchOptions }
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
