import { isRequestError } from '../errors'
import type {
  ErrorLogEntry,
  LoggerOptions,
  RequestLogger
} from '../types'
import type { Plugin } from './Plugin'
import { isPromiseLike } from '../utils/isPromiseLike'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export function loggerPlugin(defaultOptions: LoggerOptions = {}): Plugin {
  let nextRequestId = 0
  const states = new WeakMap<object, LoggerState>()

  return {
    name: 'logger',

    install(context) {
      context.hooks.onRequest(requestContext => {
        const options =
          resolveExtensionConfig(
            requestContext.config,
            'logger'
          ) ?? defaultOptions

        if (options.enabled === false) {
          return
        }

        const url = String(requestContext.config.url)
        const state: LoggerState = {
          requestId:
            options.createRequestId?.() ??
            `request-${++nextRequestId}`,
          options,
          url,
          redactedURL: redactURL(url)
        }

        states.set(requestContext, state)

        emitInfo(options, {
          type: 'request',
          requestId: state.requestId,
          timestamp: requestContext.startTime,
          method: requestContext.config.method ?? 'GET',
          url: state.redactedURL
        })
      })

      context.hooks.onResponse(requestContext => {
        const state = states.get(requestContext)

        if (!state || !requestContext.response) {
          return
        }

        const timestamp = Date.now()

        emitInfo(state.options, {
          type: 'response',
          requestId: state.requestId,
          timestamp,
          duration: Math.max(0, timestamp - requestContext.startTime),
          attempts: requestContext.attempt + 1,
          method: requestContext.config.method ?? 'GET',
          url: resolveRedactedURL(
            state,
            String(requestContext.config.url)
          ),
          status: requestContext.response.status
        })
      })

      context.hooks.onError(requestContext => {
        let state = states.get(requestContext)

        if (!state) {
          const options =
            resolveExtensionConfig(
              requestContext.config,
              'logger'
            ) ?? defaultOptions

          if (options.enabled === false) {
            return
          }

          const url = String(requestContext.config.url)
          state = {
            requestId:
              options.createRequestId?.() ??
              `request-${++nextRequestId}`,
            options,
            url,
            redactedURL: redactURL(url)
          }
          states.set(requestContext, state)

          emitInfo(options, {
            type: 'request',
            requestId: state.requestId,
            timestamp: requestContext.startTime,
            method: requestContext.config.method ?? 'GET',
            url: state.redactedURL
          })
        }

        const timestamp = Date.now()

        emitError(
          state.options,
          createErrorLog(
            requestContext.error,
            state.requestId,
            timestamp,
            Math.max(0, timestamp - requestContext.startTime),
            requestContext.attempt + 1,
            requestContext.config.method ?? 'GET',
            resolveRedactedURL(
              state,
              String(requestContext.config.url)
            )
          )
        )
      })
    }
  }
}

interface LoggerState {
  requestId: string

  options: LoggerOptions

  url: string

  redactedURL: string
}

function resolveRedactedURL(state: LoggerState, url: string): string {
  return url === state.url
    ? state.redactedURL
    : redactURL(url)
}

const consoleLogger: RequestLogger = {
  info(message, entry) {
    console.log(message, entry)
  },

  error(message, entry) {
    console.error(message, entry)
  }
}

function resolveLogger(options: LoggerOptions): RequestLogger {
  return options.logger ?? consoleLogger
}

function emitInfo(
  options: LoggerOptions,
  entry: Parameters<RequestLogger['info']>[1]
): void {
  try {
    const result = resolveLogger(options).info('[Npora Request]', entry)

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(ignoreLoggerError)
    }
  } catch {
    // Logging must not change the request lifecycle.
  }
}

function emitError(
  options: LoggerOptions,
  entry: ErrorLogEntry
): void {
  try {
    const result = resolveLogger(options).error('[Npora Request]', entry)

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(ignoreLoggerError)
    }
  } catch {
    // Logging must not replace the original request error.
  }
}

function ignoreLoggerError(): void {
  // Async logger failures are isolated from the request lifecycle.
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
  const safeURL = redactCredentials(url)
  const queryIndex = safeURL.indexOf('?')

  if (queryIndex === -1) {
    return safeURL
  }

  const hashIndex = safeURL.indexOf('#', queryIndex)
  const pathname = safeURL.slice(0, queryIndex)
  const query = safeURL.slice(
    queryIndex + 1,
    hashIndex === -1 ? undefined : hashIndex
  )
  const hash =
    hashIndex === -1 ? '' : safeURL.slice(hashIndex)
  const params = new URLSearchParams(query)

  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, '[REDACTED]')
    }
  }

  const redactedQuery = params.toString()

  return `${pathname}${redactedQuery ? `?${redactedQuery}` : ''}${hash}`
}

function redactCredentials(url: string): string {
  const schemeIndex = url.indexOf('://')
  const authorityStart =
    schemeIndex === -1
      ? (
          url.startsWith('//')
            ? 2
            : -1
        )
      : schemeIndex + 3

  if (authorityStart === -1) {
    return url
  }

  const authorityEnd = findAuthorityEnd(url, authorityStart)
  const credentialEnd = url.lastIndexOf(
    '@',
    authorityEnd - 1
  )

  if (credentialEnd < authorityStart) {
    return url
  }

  return (
    `${url.slice(0, authorityStart)}[REDACTED]@` +
    url.slice(credentialEnd + 1)
  )
}

function findAuthorityEnd(
  url: string,
  authorityStart: number
): number {
  for (let index = authorityStart; index < url.length; index += 1) {
    const character = url[index]

    if (
      character === '/' ||
      character === '?' ||
      character === '#'
    ) {
      return index
    }
  }

  return url.length
}

function createErrorLog(
  error: unknown,
  requestId: string,
  timestamp: number,
  duration: number,
  attempt: number,
  method: ErrorLogEntry['method'],
  url: string
): ErrorLogEntry {
  const lifecycle = {
    type: 'error' as const,
    requestId,
    timestamp,
    duration,
    attempt,
    method,
    url
  }

  if (isRequestError(error)) {
    return {
      ...lifecycle,
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.status
    }
  }

  if (error instanceof Error) {
    return {
      ...lifecycle,
      name: error.name,
      message: error.message
    }
  }

  return {
    ...lifecycle,
    name: 'UnknownError',
    message: String(error)
  }
}
