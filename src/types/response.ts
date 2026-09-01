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

/** Location of an item that failed validation in a streaming response. */
export interface StreamingSchemaLocation {
  /** Zero-based index among emitted SSE events or non-empty NDJSON records. */
  itemIndex: number

  /** One-based physical NDJSON line number, including blank lines. */
  lineNumber?: number

  /** SSE event type. */
  event?: string

  /** SSE event identifier. */
  eventId?: string
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
