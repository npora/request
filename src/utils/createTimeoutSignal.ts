import { RequestError } from '../errors'

export interface TimeoutSignalResult {
  signal?: AbortSignal
  clear: () => void
}

export function createTimeoutSignal(
  signal?: AbortSignal,
  timeout?: number
): TimeoutSignalResult {
  if (!timeout || timeout <= 0 || signal?.aborted) {
    return {
      signal,
      clear: noop
    }
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined

  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }

    if (signal && onAbort) {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup must continue for custom signal implementations.
      }
      onAbort = undefined
    }
  }

  if (signal) {
    onAbort = () => {
      clear()
      controller.abort(
        signal.reason ??
        new RequestError('Request aborted', {
          code: 'ABORT_ERROR'
        })
      )
    }

    try {
      signal.addEventListener(
        'abort',
        onAbort,
        {
          once: true
        }
      )
    } catch (error) {
      clear()
      throw error
    }

    if (controller.signal.aborted) {
      return {
        signal: controller.signal,
        clear
      }
    }
  }

  try {
    timer = setTimeout(() => {
      clear()
      controller.abort(
        new RequestError(`Request timeout after ${timeout}ms`, {
          code: 'TIMEOUT_ERROR'
        })
      )
    }, timeout)
  } catch (error) {
    clear()
    throw error
  }

  if (controller.signal.aborted) {
    clear()
  }

  return {
    signal: controller.signal,
    clear
  }
}

function noop(): void {}
