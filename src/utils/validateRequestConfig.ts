import { RequestError } from '../errors'
import type { RequestConfig } from '../types'
import { isURLSearchParams } from './isURLSearchParams'
import { MAX_TIMER_DELAY } from './maxTimerDelay'
import { hasOwnProperty } from './hasOwnProperty'
import { isAbsoluteURL } from './buildRequest'

const BODY_FIELDS = [
  'body',
  'json',
  'form',
  'formData'
] as const

/**
 * Validate configuration before request hooks or adapters act on it.
 */
export function validateRequestConfig(
  config: RequestConfig,
  headersRequired: boolean
): Headers | undefined {
  validateConfigPrototype(config)
  validateURL(config)
  validateMethod(config)
  validateTimeout(config)
  validateLimits(config)
  validateQuery(config)
  validateResponseOptions(config)
  validateSchema(config)
  const headers = headersRequired || config.headers !== undefined
    ? validateHeaders(config)
    : undefined
  validateBody(config)

  return headers
}

function validateConfigPrototype(
  config: Partial<RequestConfig>
): void {
  const prototype = Object.getPrototypeOf(config)

  if (prototype === null) {
    return
  }

  const source = prototype === Object.prototype
    ? Object.prototype
    : config

  for (const key in source) {
    if (!hasOwnProperty.call(config, key)) {
      throw configError(
        'Request config contains inherited fields',
        config as RequestConfig
      )
    }
  }
}

function validateQuery(config: RequestConfig): void {
  if (config.query !== undefined && config.searchParams !== undefined) {
    throw configError(
      'Request query and searchParams are mutually exclusive',
      config
    )
  }

  if (
    config.searchParams !== undefined &&
    !isURLSearchParams(config.searchParams)
  ) {
    throw configError(
      'Request searchParams must be URLSearchParams',
      config
    )
  }
}

function validateMethod(config: RequestConfig): void {
  switch (config.method) {
    case undefined:
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'HEAD':
    case 'OPTIONS':
      return

    default:
      throw configError('Request method is invalid', config)
  }
}

function validateResponseOptions(config: RequestConfig): void {
  switch (config.responseType) {
    case undefined:
    case 'json':
    case 'text':
    case 'blob':
    case 'arrayBuffer':
    case 'stream':
    case 'sse':
    case 'ndjson':
      break

    default:
      throw configError('Request responseType is invalid', config)
  }

  if (
    config.validateStatus !== undefined &&
    typeof config.validateStatus !== 'function'
  ) {
    throw configError('Request validateStatus must be a function', config)
  }
}

function validateSchema(config: RequestConfig): void {
  if (config.schema === undefined) {
    return
  }

  try {
    const candidate = config.schema as unknown

    if (
      (typeof candidate !== 'object' && typeof candidate !== 'function') ||
      candidate === null
    ) {
      throw new TypeError('Schema must be an object or function')
    }

    const standard = (candidate as {
      '~standard'?: unknown
    })['~standard']

    if (
      typeof standard !== 'object' ||
      standard === null ||
      (standard as { version?: unknown }).version !== 1 ||
      typeof (standard as { vendor?: unknown }).vendor !== 'string' ||
      typeof (standard as { validate?: unknown }).validate !== 'function'
    ) {
      throw new TypeError('Schema does not implement Standard Schema v1')
    }
  } catch (error) {
    throw configError(
      'Request schema must implement Standard Schema v1',
      config,
      error
    )
  }
}

function validateLimits(config: RequestConfig): void {
  validateLimit(
    config.maxRequestSize,
    'Request maxRequestSize',
    config
  )
  validateLimit(
    config.maxResponseSize,
    'Request maxResponseSize',
    config
  )
  validateLimit(
    config.maxFormDataDepth,
    'Request maxFormDataDepth',
    config
  )
}

function validateLimit(
  value: number | undefined,
  name: string,
  config: RequestConfig
): void {
  if (value === undefined || value === Number.POSITIVE_INFINITY) {
    return
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw configError(
      `${name} must be a non-negative safe integer or Infinity`,
      config
    )
  }
}

function validateURL(config: RequestConfig): void {
  if (typeof config.url !== 'string') {
    throw configError('Request url must be a string', config)
  }

  if (
    config.baseURL !== undefined &&
    typeof config.baseURL !== 'string'
  ) {
    throw configError('Request baseURL must be a string', config)
  }

  if (
    config.allowAbsoluteUrls !== undefined &&
    typeof config.allowAbsoluteUrls !== 'boolean'
  ) {
    throw configError(
      'Request allowAbsoluteUrls must be a boolean',
      config
    )
  }

  if (
    isMalformedHttpURL(config.url) ||
    (
      config.baseURL !== undefined &&
      isMalformedHttpURL(config.baseURL)
    )
  ) {
    throw configError(
      'Request URL is malformed',
      config
    )
  }

  if (
    config.baseURL &&
    config.allowAbsoluteUrls === false &&
    isAbsoluteURL(config.url)
  ) {
    throw configError(
      'Absolute request URLs are not allowed with this baseURL',
      config
    )
  }
}

function isMalformedHttpURL(value: string): boolean {
  return /^https?:(?!\/\/)/i.test(value)
}

function validateTimeout(config: RequestConfig): void {
  if (config.timeout === undefined) {
    return
  }

  if (
    !Number.isFinite(config.timeout) ||
    config.timeout < 0 ||
    config.timeout > MAX_TIMER_DELAY
  ) {
    throw configError(
      'Request timeout is out of range',
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
  let hasBody = config.body != null

  if (config.json != null) {
    if (hasBody) {
      throwBodyConflict(config)
    }

    hasBody = true
  }

  if (config.form != null) {
    if (hasBody) {
      throwBodyConflict(config)
    }

    hasBody = true
  }

  if (config.formData != null) {
    if (hasBody) {
      throwBodyConflict(config)
    }

    hasBody = true
  }

  if (!hasBody) {
    return
  }

  const method = config.method ?? 'GET'

  if (
    (method === 'GET' || method === 'HEAD')
  ) {
    throw configError(
      `${method} requests cannot include a body`,
      config
    )
  }
}

function throwBodyConflict(config: RequestConfig): never {
  const activeFields = BODY_FIELDS.filter(field => {
    const value = config[field]

    return value !== undefined && value !== null
  })

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
