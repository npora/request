import { RequestError } from '../errors'
import type { RequestConfig } from '../types'

const BODY_FIELDS = [
  'body',
  'json',
  'form',
  'formData'
] as const

/**
 * Validate configuration before request hooks or adapters act on it.
 */
export function validateRequestConfig(config: RequestConfig): Headers {
  validateURL(config)
  validateTimeout(config)
  const headers = validateHeaders(config)
  validateBody(config)

  return headers
}

function validateURL(config: RequestConfig): void {
  if (typeof config.url !== 'string') {
    throw configError('Request url must be a string', config)
  }
}

function validateTimeout(config: RequestConfig): void {
  if (config.timeout === undefined) {
    return
  }

  if (!Number.isFinite(config.timeout) || config.timeout < 0) {
    throw configError(
      'Request timeout must be a finite, non-negative number',
      config
    )
  }
}

function validateHeaders(config: RequestConfig): Headers {
  try {
    return new Headers(config.headers)
  } catch (error) {
    throw configError('Request headers are invalid', config, error)
  }
}

function validateBody(config: RequestConfig): void {
  const activeFields = BODY_FIELDS.filter(key => {
    const value = config[key]

    return value !== undefined && value !== null
  })

  if (activeFields.length <= 1) {
    const method = config.method ?? 'GET'

    if (
      activeFields.length === 1 &&
      (method === 'GET' || method === 'HEAD')
    ) {
      throw configError(
        `${method} requests cannot include a body`,
        config
      )
    }

    return
  }

  throw configError(
    `Request body options are mutually exclusive: ${activeFields.join(', ')}`,
    config
  )
}

function configError(
  message: string,
  config: RequestConfig,
  cause?: unknown
): RequestError {
  return new RequestError(message, {
    code: 'CONFIG_ERROR',
    config,
    cause
  })
}
