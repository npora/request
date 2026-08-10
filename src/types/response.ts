import type { RequestConfig } from './config'

/**
 * A message decoded from a `text/event-stream` response.
 */
export interface ServerSentEvent {
  /**
   * Event payload with multiple `data` fields joined by newlines.
   */
  data: string

  /**
   * Event type, defaulting to `message`.
   */
  event: string

  /**
   * Most recently observed event identifier.
   */
  id: string

  /**
   * Most recently observed server reconnection delay in milliseconds.
   */
  retry?: number
}

/**
 * Npora response.
 */
export interface NporaResponse<T = unknown> {
  /**
   * Parsed response data.
   */
  data: T

  /**
   * HTTP status code.
   */
  status: number

  /**
   * HTTP status text.
   */
  statusText: string

  /**
   * Response headers.
   */
  headers: Headers

  /**
   * Request config.
   */
  config: RequestConfig

  /**
   * Raw Fetch Response.
   */
  raw: Response
}
