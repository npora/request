import { RequestError } from '../errors'
import type { Client } from '../client'
import type { Plugin } from './Plugin'
import type { RequestConfig, RetryOptions } from '../types'

interface NormalizedRetryOptions {
  retries: number
  delay: (attempt: number, error: unknown) => number | Promise<number>
  shouldRetry: (error: unknown, attempt: number) => boolean | Promise<boolean>
}

export function retryPlugin(defaultOptions: RetryOptions = {}): Plugin {
  return {
    name: 'retry',

    install(client: Client) {
      const originalRequest = client.request.bind(client)

      client.request = async function requestWithRetry<T = unknown>(
        config: RequestConfig
      ): Promise<T> {
        const retryOptions = normalizeRetryOptions(config.retry, defaultOptions)

        let attempt = 0

        while (true) {
          try {
            return await originalRequest<T>(config)
          } catch (error) {
            const canRetry =
              attempt < retryOptions.retries &&
              (await retryOptions.shouldRetry(error, attempt))

            if (!canRetry) {
              throw error
            }

            const delay = await retryOptions.delay(attempt, error)

            if (delay > 0) {
              await sleep(delay)
            }

            attempt++
          }
        }
      }
    }
  }
}

function normalizeRetryOptions(
  retry?: number | RetryOptions,
  defaults: RetryOptions = {}
): NormalizedRetryOptions {
  if (typeof retry === 'number') {
    return {
      retries: retry,
      delay: normalizeDelay(defaults.delay),
      shouldRetry: defaults.shouldRetry ?? defaultShouldRetry
    }
  }

  return {
    retries: retry?.retries ?? defaults.retries ?? 0,
    delay: normalizeDelay(retry?.delay ?? defaults.delay),
    shouldRetry: retry?.shouldRetry ?? defaults.shouldRetry ?? defaultShouldRetry
  }
}

function normalizeDelay(
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
