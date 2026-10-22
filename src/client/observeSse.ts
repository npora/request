import { RequestError } from '../errors/RequestError'
import type { SseState, SseStateObserver } from '../types/response'
import { withEarlyIteratorCleanup } from '../utils/withEarlyIteratorCleanup'

/** Observers report transport lifecycle; they never control stream delivery. */
export function observeSse<T>(
  connect: (notify?: SseStateObserver) => Promise<AsyncIterable<T>>,
  observer: SseStateObserver | undefined,
  signal?: AbortSignal
): Promise<AsyncIterable<T>> {
  if (observer === undefined) return connect()
  if (typeof observer !== 'function') {
    return Promise.reject(new RequestError('Invalid SSE state observer', {
      code: 'CONFIG_ERROR'
    }))
  }

  let current: SseState | undefined
  const notify = (state: SseState) => {
    if (current === state || current === 'closed' || current === 'errored') return
    current = state
    if (state === 'closed' || state === 'errored') {
      try { signal?.removeEventListener('abort', aborted) } catch { /* best effort */ }
    }
    try {
      // Also observe rejected async callbacks, without awaiting user code.
      void Promise.resolve(observer(state)).catch(() => {})
    } catch {
      // UI observers must not alter request results or resource cleanup.
    }
  }
  const aborted = () => notify('closed')
  notify('connecting')
  try {
    if (signal?.aborted) aborted()
    else signal?.addEventListener('abort', aborted, { once: true })
  } catch (error) {
    notify('errored')
    return Promise.reject(error)
  }

  return Promise.resolve().then(() => connect(notify)).then(stream => {
    return withEarlyIteratorCleanup(start => (async function* () {
      start()
      try {
        yield* stream
      } catch (error) {
        notify(signal?.aborted ? 'closed' : 'errored')
        throw error
      } finally {
        notify('closed')
      }
    })(), () => {
      notify('closed')
      return stream[Symbol.asyncIterator]().return?.()
    })
  }, error => {
    notify(signal?.aborted ? 'closed' : 'errored')
    throw error
  })
}
