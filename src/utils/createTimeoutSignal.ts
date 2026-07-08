import { RequestError } from '../errors'

export interface TimeoutSignalResult {
  signal?: AbortSignal
  clear: () => void
  getReason: () => unknown
}

export function createTimeoutSignal(
  signal?: AbortSignal,
  timeout?: number
): TimeoutSignalResult {
  if (!timeout || timeout <= 0) {
    return {
      signal,
      clear: noop,
      getReason: () => signal?.reason
    }
  }

  const controller = new AbortController()

  let abortReason: unknown
  let abortListener: (() => void) | undefined

  const timer = setTimeout(() => {
    abortReason = new RequestError(`Request timeout after ${timeout}ms`, {
      code: 'TIMEOUT_ERROR'
    })

    controller.abort(abortReason)
  }, timeout)

  if (signal) {
    abortListener = () => {
      abortReason =
        signal.reason ??
        new RequestError('Request aborted', {
          code: 'ABORT_ERROR'
        })

      controller.abort(abortReason)
    }

    if (signal.aborted) {
      abortListener()
    } else {
      signal.addEventListener('abort', abortListener, {
        once: true
      })
    }
  }

  return {
    signal: controller.signal,

    clear: () => {
      clearTimeout(timer)

      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener)
      }
    },

    getReason: () => abortReason
  }
}

function noop(): void {}
