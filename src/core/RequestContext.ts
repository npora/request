import type { NporaResponse, RequestConfig } from '../types'

export class RequestContext<T = unknown> {
  public config: RequestConfig

  public response?: NporaResponse<T>

  public error?: unknown

  public readonly startTime: number

  public endTime?: number

  public attempt = 0

  constructor(config: RequestConfig) {
    this.config = config
    this.startTime = Date.now()
  }
}
