/**
 * Request error options.
 */
export interface RequestErrorOptions {
  /**
   * Error code.
   */
  code: string

  /**
   * HTTP status.
   */
  status?: number

  /**
   * Original error.
   */
  cause?: unknown
}

/**
 * Unified request error.
 */
export class RequestError extends Error {
  /**
   * Error code.
   */
  public readonly code: string

  /**
   * HTTP status.
   */
  public readonly status?: number

  /**
   * Original error.
   */
  public readonly cause?: unknown

  constructor(message: string, options: RequestErrorOptions) {
    super(message)

    this.name = 'RequestError'
    this.code = options.code
    this.status = options.status
    this.cause = options.cause
  }
}
