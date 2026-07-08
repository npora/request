import { RequestError } from '../errors'
import type { RetryOptions } from '../types'

export interface NormalizedRetryOptions {
  retries: number
  delay: (attempt: number, error: unknown) => number | Promise<number>
  shouldRetry: (error: unknown, attempt: number) => boolean | Promise<boolean>
}

export function normalizeRetryOptions(
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
