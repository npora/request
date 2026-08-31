import { isRequestError, RequestError } from '../errors'
import type { RequestConfig } from '../types'

export function throwIfAborted(config: RequestConfig): void {
  const signal = config.signal

  if (signal?.aborted) {
    throw createAbortError(signal.reason, config)
  }
}

export function createAbortError(
  reason: unknown,
  config: RequestConfig,
  cause: unknown = reason
): RequestError {
  if (isRequestError(reason)) {
    return new RequestError(reason.message, {
      code: reason.code,
      status: reason.status,
      data: reason.data,
      response: reason.response,
      config: reason.config ?? config,
      cause: reason
    })
  }

  return new RequestError('Request aborted', {
    code: 'ABORT_ERROR',
    config,
    cause
  })
}
