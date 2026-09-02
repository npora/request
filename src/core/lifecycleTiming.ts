import { isRequestError, RequestError } from '../errors'
import type { NporaResponse, RequestConfig } from '../types'
import { finalizeStreamingResponse } from '../utils'
import { isReadableStream } from '../utils/isReadableStream'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'

export function waitForRetry(
  milliseconds: number,
  config: RequestConfig
): Promise<void> | undefined {
  const signal = config.signal

  if (signal?.aborted) {
    return Promise.reject(createRetryAbortError(signal.reason, config))
  }
  if (milliseconds <= 0) return undefined

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const cleanup = () => {
      try {
        signal?.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup failures must not retain a retry wait.
      }
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      cleanup()
      reject(createRetryAbortError(signal?.reason, config))
    }

    try {
      signal?.addEventListener('abort', onAbort, { once: true })
    } catch (error) {
      if (!settled) {
        settled = true
        cleanup()
        reject(error)
      }
      return
    }

    if (signal?.aborted) onAbort()
    if (settled) return

    try {
      timer = setTimeout(() => {
        settled = true
        cleanup()
        resolve()
      }, Math.min(milliseconds, MAX_TIMER_DELAY))
    } catch (error) {
      settled = true
      cleanup()
      reject(error)
      return
    }

    if (settled) {
      clearTimeout(timer)
      timer = undefined
    }
  })
}

export function finalizeTotalTimeout<T>(
  response: NporaResponse<T>,
  clear: () => void
): NporaResponse<T> {
  const data = response.data

  if (isReadableStream(data)) {
    const source = data === response.raw.body
      ? response.raw
      : new Response(data, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        })
    const raw = finalizeStreamingResponse(
      source,
      undefined,
      response.config,
      clear
    )
    return { ...response, data: raw.body as T, raw }
  }

  if (isAsyncIterable(data)) {
    return { ...response, data: finalizeAsyncIterable(data, clear) as T }
  }

  clear()
  return response
}

function createRetryAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  if (isRequestError(reason)) {
    return new RequestError(reason.message, {
      code: reason.code,
      status: reason.status,
      data: reason.data,
      response: reason.response,
      config: reason.config ?? config,
      cause: reason
    })
  }
  return new RequestError('Request aborted during retry delay', {
    code: 'ABORT_ERROR',
    config,
    cause: reason
  })
}

function finalizeAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  clear: () => void
): AsyncIterable<T> {
  return (async function* () {
    try {
      yield* iterable
    } finally {
      clear()
    }
  })()
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
}
