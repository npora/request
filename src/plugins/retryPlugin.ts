import { RequestError } from '../errors'
import type { RetryOptions } from '../types'
import type { Plugin } from './Plugin'

interface NormalizedRetryOptions {
  retries: number

  delay: (
    attempt: number,
    error: unknown
  ) => number | Promise<number>

  shouldRetry: (
    error: unknown,
    attempt: number
  ) => boolean | Promise<boolean>
}

export function retryPlugin(
  defaultOptions: RetryOptions = {}
): Plugin {
  return {
    name: 'retry',

    install(context) {
      context.hooks.onRetry(async (requestContext, attempt) => {
        if (!requestContext.error) {
          return undefined
        }

        const retryOptions = normalizeRetryOptions(
          requestContext.config.retry,
          defaultOptions
        )

        if (attempt >= retryOptions.retries) {
          return undefined
        }

        const shouldRetry = await retryOptions.shouldRetry(
          requestContext.error,
          attempt
        )

        if (!shouldRetry) {
          return undefined
        }

        return {
          retry: true,
          delay: await retryOptions.delay(
            attempt,
            requestContext.error
          )
        }
      })
    }
  }
}

function normalizeRetryOptions(
  retry?: number | RetryOptions,
  defaults: RetryOptions = {}
): NormalizedRetryOptions {
  if (typeof retry === 'number') {
    return {
      retries: normalizeRetries(retry),
      delay: normalizeDelay(defaults.delay),
      shouldRetry:
        defaults.shouldRetry ?? defaultShouldRetry
    }
  }

  return {
    retries: normalizeRetries(
      retry?.retries ?? defaults.retries ?? 0
    ),
    delay: normalizeDelay(
      retry?.delay ?? defaults.delay
    ),
    shouldRetry:
      retry?.shouldRetry ??
      defaults.shouldRetry ??
      defaultShouldRetry
  }
}

function normalizeRetries(retries: number): number {
  if (!Number.isFinite(retries)) {
    return 0
  }

  return Math.max(0, Math.floor(retries))
}

function normalizeDelay(
  delay?: RetryOptions['delay']
): NormalizedRetryOptions['delay'] {
  if (typeof delay === 'number') {
    const normalizedDelay = Math.max(0, delay)

    return () => normalizedDelay
  }

  return delay ?? defaultRetryDelay
}

function defaultRetryDelay(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 1000)
}

function defaultShouldRetry(error: unknown): boolean {
  if (!(error instanceof RequestError)) {
    return false
  }

  if (error.code === 'NETWORK_ERROR') {
    return true
  }

  if (error.status === undefined) {
    return false
  }

  return (
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  )
}
