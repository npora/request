import type { NporaResponse, RequestConfig } from '../types'

/**
 * Public request error codes.
 */
export type RequestErrorCode =
  | 'CONFIG_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'ABORT_ERROR'
  | 'PARSER_ERROR'

export interface RequestErrorOptions<T = unknown> {
  /**
   * Stable machine-readable error code.
   */
  code: RequestErrorCode

  /**
   * HTTP response status when available.
   */
  status?: number

  /**
   * Parsed response body when the server returned a response.
   */
  data?: T

  /**
   * Complete response metadata when the server returned a response.
   */
  response?: NporaResponse<T>

  /**
   * Effective request configuration.
   */
  config?: RequestConfig

  /**
   * Original error.
   */
  cause?: unknown
}

/**
 * Unified public error for all request failures.
 */
export class RequestError<T = unknown> extends Error {
  readonly code: RequestErrorCode

  readonly status?: number

  readonly data?: T

  readonly response?: NporaResponse<T>

  readonly config?: RequestConfig

  readonly cause?: unknown

  constructor(message: string, options: RequestErrorOptions<T>) {
    super(message)

    this.name = 'RequestError'
    this.code = options.code
    this.status = options.status ?? options.response?.status
    this.data = options.data ?? options.response?.data
    this.response = options.response
    this.config = options.config ?? options.response?.config
    this.cause = options.cause

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
