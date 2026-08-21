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
      signal.removeEventListener('abort', onAbort)
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

    signal.addEventListener(
      'abort',
      onAbort,
      {
        once: true
      }
    )
  }

  timer = setTimeout(() => {
    clear()
    controller.abort(
      new RequestError(`Request timeout after ${timeout}ms`, {
        code: 'TIMEOUT_ERROR'
      })
    )
  }, timeout)

  return {
    signal: controller.signal,
    clear
  }
}

function noop(): void {}
