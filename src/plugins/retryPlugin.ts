import { RequestError } from '../errors'
import type { Plugin } from './Plugin'
import type { RetryOptions } from '../types'

interface NormalizedRetryOptions {
  retries: number
  delay: (attempt: number, error: unknown) => number | Promise<number>
  shouldRetry: (error: unknown, attempt: number) => boolean | Promise<boolean>
}

/**
 * Retry Plugin
 *
 * 内置重试插件。
 */
export function retryPlugin(): Plugin {
  return {
    name: 'builtin:retry',

    async resolveRetry(context, attempt) {
      if (!context.error) {
        return {
          retry: false,
          delay: 0
        }
      }

      const retryOptions = normalizeRetryOptions(context.config.retry)

      const canRetry =
        attempt < retryOptions.retries &&
        (await retryOptions.shouldRetry(context.error, attempt))

      if (!canRetry) {
        return {
          retry: false,
          delay: 0
        }
      }

      return {
        retry: true,
        delay: await retryOptions.delay(attempt, context.error)
      }
    }
  }
}

function normalizeRetryOptions(
  retry?: number | RetryOptions
): NormalizedRetryOptions {
  if (typeof retry === 'number') {
    return {
      retries: retry,
      delay: defaultRetryDelay,
      shouldRetry: defaultShouldRetry
    }
  }

  return {
    retries: retry?.retries ?? 0,
    delay: normalizeRetryDelay(retry?.delay),
    shouldRetry: retry?.shouldRetry ?? defaultShouldRetry
  }
}

function normalizeRetryDelay(
  delay?: RetryOptions['delay']
): NormalizedRetryOptions['delay'] {
  if (typeof delay === 'number') {
    return () => delay
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

  if (!error.status) {
    return false
  }

  return error.status === 408 || error.status === 429 || error.status >= 500
}
