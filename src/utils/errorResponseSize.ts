import type { RequestConfig } from '../types'

export const DEFAULT_MAX_ERROR_RESPONSE_SIZE = 10 * 1024 * 1024

/**
 * Return the soft parsing limit for an HTTP error body. An explicit,
 * stricter maxResponseSize remains authoritative and must surface its own
 * RESPONSE_TOO_LARGE error.
 */
export function resolveErrorResponseSizeLimit(
  config: RequestConfig
): number | undefined {
  const errorLimit =
    config.maxErrorResponseSize ?? DEFAULT_MAX_ERROR_RESPONSE_SIZE
  const responseLimit = config.maxResponseSize

  return Number.isFinite(errorLimit) &&
    (
      !Number.isFinite(responseLimit) ||
      errorLimit < (responseLimit ?? Number.POSITIVE_INFINITY)
    )
    ? errorLimit
    : undefined
}
