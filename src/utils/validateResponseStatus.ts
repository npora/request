import { RequestError } from '../errors'
import type { RequestConfig } from '../types'

/**
 * Run application status validation with stable error classification.
 */
export function validateResponseStatus(
  status: number,
  config: RequestConfig
): boolean {
  try {
    return config.validateStatus
      ? config.validateStatus(status)
      : status >= 200 && status < 300
  } catch (error) {
    throw new RequestError('Request validateStatus callback failed', {
      code: 'CONFIG_ERROR',
      status,
      config,
      cause: error
    })
  }
}
