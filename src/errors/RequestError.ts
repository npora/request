import type { NporaResponse, RequestConfig } from '../types'

const REQUEST_ERROR_BRAND = Symbol.for(
  '@npora/request/RequestError'
)

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
  | 'SCHEMA_ERROR'
  | 'REQUEST_TOO_LARGE'
  | 'RESPONSE_TOO_LARGE'
  | 'CIRCUIT_OPEN'
  | 'CONCURRENCY_LIMIT'

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

    Object.defineProperty(this, REQUEST_ERROR_BRAND, {
      value: true
    })
    this.name = 'RequestError'
    this.code = options.code
    this.status = options.status ?? options.response?.status
    this.data = options.data ?? options.response?.data
    this.response = options.response
    this.config = options.config ?? options.response?.config
    this.cause = options.cause
  }

  /**
   * Return a privacy-reduced representation for logs and telemetry.
   *
   * Request configuration, response bodies and causes are deliberately
   * excluded because they can contain credentials or application data.
   */
  toJSON(): {
    name: string
    message: string
    code: RequestErrorCode
    status?: number
  } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status
    }
  }
}

/**
 * Identify request errors across realms and duplicated package instances.
 */
export function isRequestError<T = unknown>(
  value: unknown
): value is RequestError<T> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false
  }

  try {
    return Reflect.get(value, REQUEST_ERROR_BRAND) === true
  } catch {
    return false
  }
}
