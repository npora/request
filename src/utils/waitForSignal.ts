import type { RequestConfig } from '../types'
import { createAbortError } from './createAbortError'

export function waitForSignal<T>(
  start: () => T | PromiseLike<T>,
  config: RequestConfig
): Promise<T> {
  const signal = config.signal

  if (!signal) {
    try {
      return Promise.resolve(start())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError(signal.reason, config))
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup failures must not retain or replace a request result.
      }
    }
    const resolveOnce = (value: T) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(value)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      rejectOnce(createAbortError(signal.reason, config))
    }

    try {
      signal.addEventListener('abort', onAbort, { once: true })
    } catch (error) {
      rejectOnce(error)
      return
    }

    if (signal.aborted) {
      onAbort()
    }

    if (settled) {
      return
    }

    try {
      Promise.resolve(start()).then(resolveOnce, rejectOnce)
    } catch (error) {
      rejectOnce(error)
    }
  })
}
