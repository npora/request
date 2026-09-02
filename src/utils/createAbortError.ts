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
    return reason
  }

  return new RequestError('Request aborted', {
    code: 'ABORT_ERROR',
    config,
    cause
  })
}
