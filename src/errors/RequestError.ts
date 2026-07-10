/**
 * Public request error codes.
 */
export type RequestErrorCode =
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'ABORT_ERROR'
  | 'PARSER_ERROR'

export interface RequestErrorOptions {
  /**
   * Stable machine-readable error code.
   */
  code: RequestErrorCode

  /**
   * HTTP response status when available.
   */
  status?: number

  /**
   * Original error.
   */
  cause?: unknown
}

/**
 * Unified public error for all request failures.
 */
export class RequestError extends Error {
  readonly code: RequestErrorCode

  readonly status?: number

  readonly cause?: unknown

  constructor(message: string, options: RequestErrorOptions) {
    super(message)

    this.name = 'RequestError'
    this.code = options.code
    this.status = options.status
    this.cause = options.cause

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
