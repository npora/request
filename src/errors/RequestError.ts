/**
 * Request Error
 *
 * Nova Request 统一异常对象。
 */
export class RequestError extends Error {

  /**
   * HTTP 状态码。
   */
  status?: number

  /**
   * 错误码。
   */
  code?: string

  /**
   * 原始错误对象。
   */
  cause?: unknown

  constructor(
    message: string,
    options?: {
      status?: number
      code?: string
      cause?: unknown
    }
  ) {
    super(message)

    this.name = 'RequestError'

    this.status = options?.status

    this.code = options?.code

    this.cause = options?.cause
  }
}