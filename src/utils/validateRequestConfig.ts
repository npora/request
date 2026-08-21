import { RequestError } from '../errors'
import type {
  HttpMethod,
  RequestConfig,
  ResponseType
} from '../types'
import { isURLSearchParams } from './isURLSearchParams'

const BODY_FIELDS = [
  'body',
  'json',
  'form',
  'formData'
] as const

const RESPONSE_TYPES: readonly ResponseType[] = [
  'json',
  'text',
  'blob',
  'arrayBuffer',
  'stream',
  'sse',
  'ndjson'
]

const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
]

/**
 * Validate configuration before request hooks or adapters act on it.
 */
export function validateRequestConfig(config: RequestConfig): Headers {
  validateURL(config)
  validateMethod(config)
  validateTimeout(config)
  validateLimits(config)
  validateQuery(config)
  validateResponseOptions(config)
  validateSchema(config)
  const headers = validateHeaders(config)
  validateBody(config)

  return headers
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
  if (
    config.method !== undefined &&
    !HTTP_METHODS.includes(config.method)
  ) {
    throw configError('Request method is invalid', config)
  }
}

function validateResponseOptions(config: RequestConfig): void {
  if (
    config.responseType !== undefined &&
    !RESPONSE_TYPES.includes(config.responseType)
  ) {
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
  if (
    config.body == null &&
    config.json == null &&
    config.form == null &&
    config.formData == null
  ) {
    return
  }

  let activeField: typeof BODY_FIELDS[number] | undefined

  for (const key of BODY_FIELDS) {
    const value = config[key]

    if (value === undefined || value === null) {
      continue
    }

    if (activeField) {
      const activeFields = BODY_FIELDS.filter(field => {
        const fieldValue = config[field]

        return fieldValue !== undefined && fieldValue !== null
      })

      throw configError(
        `Request body options are mutually exclusive: ${activeFields.join(', ')}`,
        config
      )
    }

    activeField = key
  }

  const method = config.method ?? 'GET'

  if (
    activeField &&
    (method === 'GET' || method === 'HEAD')
  ) {
    throw configError(
      `${method} requests cannot include a body`,
      config
    )
  }
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
