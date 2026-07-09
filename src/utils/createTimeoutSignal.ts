import { RequestError } from '../errors'

export interface TimeoutSignalResult {
  signal?: AbortSignal
  clear: () => void
}

export function createTimeoutSignal(
  signal?: AbortSignal,
  timeout?: number
): TimeoutSignalResult {
  if (!timeout || timeout <= 0) {
    return {
      signal,
      clear: noop
    }
  }

  const controller = new AbortController()

  const timer = setTimeout(() => {
    controller.abort(
      new RequestError(`Request timeout after ${timeout}ms`, {
        code: 'TIMEOUT_ERROR'
      })
    )
  }, timeout)

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener(
        'abort',
        () => {
          controller.abort(
            signal.reason ??
            new RequestError('Request aborted', {
              code: 'ABORT_ERROR'
            })
          )
        },
        {
          once: true
        }
      )
    }
  }

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
    }
  }
}

function noop(): void {}
