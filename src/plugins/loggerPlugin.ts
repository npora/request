import { RequestError } from '../errors'
import type { LoggerOptions } from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export function loggerPlugin(defaultOptions: LoggerOptions = {}): Plugin {
  return {
    name: 'logger',

    install(context) {
      context.interceptors.request.use(config => {
        const logger =
          resolveExtensionConfig(
            config,
            'logger'
          ) ?? defaultOptions

        if (logger.enabled === false) {
          return config
        }

        console.log('[Npora Request]', {
          type: 'request',
          method: config.method ?? 'GET',
          url: redactURL(config.url)
        })

        return config
      })

      context.interceptors.response.use(response => {
        const logger =
          resolveExtensionConfig(
            response.config,
            'logger'
          ) ?? defaultOptions

        if (logger.enabled === false) {
          return response
        }

        console.log('[Npora Request]', {
          type: 'response',
          method: response.config.method ?? 'GET',
          url: redactURL(response.config.url),
          status: response.status
        })

        return response
      })

      context.interceptors.error.use(error => {
        const config =
          error instanceof RequestError
            ? error.config
            : undefined
        const logger = config
          ? (
              resolveExtensionConfig(
                config,
                'logger'
              ) ?? defaultOptions
            )
          : defaultOptions

        if (logger.enabled === false) {
          return error
        }

        console.error(
          '[Npora Request]',
          createErrorLog(error)
        )

        return error
      })
    }
  }
}

const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'api-key',
  'api_key',
  'apikey',
  'authorization',
  'client_secret',
  'password',
  'refresh_token',
  'secret',
  'sig',
  'signature',
  'token'
])

function redactURL(url: string): string {
  const queryIndex = url.indexOf('?')

  if (queryIndex === -1) {
    return url
  }

  const hashIndex = url.indexOf('#', queryIndex)
  const pathname = url.slice(0, queryIndex)
  const query = url.slice(
    queryIndex + 1,
    hashIndex === -1 ? undefined : hashIndex
  )
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const params = new URLSearchParams(query)

  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, '[REDACTED]')
    }
  }

  const redactedQuery = params.toString()

  return `${pathname}${redactedQuery ? `?${redactedQuery}` : ''}${hash}`
}

function createErrorLog(error: unknown): Record<string, unknown> {
  if (error instanceof RequestError) {
    return {
      type: 'error',
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.status,
      method: error.config?.method ?? 'GET',
      url: error.config
        ? redactURL(error.config.url)
        : undefined
    }
  }

  if (error instanceof Error) {
    return {
      type: 'error',
      name: error.name,
      message: error.message
    }
  }

  return {
    type: 'error',
    message: String(error)
  }
}
