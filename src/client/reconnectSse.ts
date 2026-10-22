import { isRequestError, RequestError } from '../errors'
import type {
  NporaResponse,
  RequestConfig,
  RequestURL,
  ServerSentEvent,
  SseReconnectOptions,
  SseStateObserver
} from '../types'
import { waitForRetry } from '../core/lifecycleTiming'
import { throwIfAborted } from '../utils/createAbortError'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'
import { withSseControl } from '../utils/sseControl'
import { withEarlyIteratorCleanup } from '../utils/withEarlyIteratorCleanup'

type SseStreamResponse = NporaResponse<AsyncIterable<ServerSentEvent>>

interface ReconnectState {
  lastEventId?: string
  serverDelay?: number
}

export function createReconnectingSse(
  url: RequestURL,
  config: Omit<RequestConfig, 'url'>,
  options: SseReconnectOptions,
  connect: (config: Omit<RequestConfig, 'url'>) => Promise<SseStreamResponse>,
  notify?: SseStateObserver
): Promise<AsyncIterable<ServerSentEvent>> {
  const initialConfig: RequestConfig = {
    ...config,
    url,
    method: 'GET',
    responseType: 'sse'
  }

  try {
    validateSseReconnect(options, initialConfig)
  } catch (error) {
    return Promise.reject(error)
  }

  const state: ReconnectState = {}

  const open = (response: SseStreamResponse) => {
    notify?.(response.status === 204 ? 'closed' : 'open')
    return response
  }
  return connect(withSseControl(config, observerFor(state))).then(open).then(first => reconnectSse(
    first,
    initialConfig,
    options,
    state,
    () => connect(withSseControl(
      reconnectConfig(config, state.lastEventId),
      observerFor(state)
    )).then(open),
    notify
  ))
}

export function validateSseReconnect(
  options: SseReconnectOptions,
  config: RequestConfig
): void {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !Number.isSafeInteger(options.maxAttempts) ||
    options.maxAttempts < 1
  ) {
    throw invalidReconnect(config)
  }

  for (const value of [options.delay, options.maxDelay]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMER_DELAY)
    ) {
      throw invalidReconnect(config)
    }
  }
}

export function reconnectSse(
  first: SseStreamResponse,
  config: RequestConfig,
  options: SseReconnectOptions,
  state: ReconnectState,
  connect: () => Promise<SseStreamResponse>,
  notify?: SseStateObserver
): AsyncIterable<ServerSentEvent> {
  return withEarlyIteratorCleanup(start => (async function* () {
    start()
    let current: SseStreamResponse | undefined = first
    let lastError: unknown
    let attempts = 0

    while (true) {
      if (current) {
        if (current.status === 204) return

        try {
          if (current.data) yield* current.data
          lastError = undefined
        } catch (error) {
          if (!isRetryableDisconnect(error)) {
            throw error
          }
          lastError = error
        }
        current = undefined
      }

      throwIfAborted(config)

      if (attempts >= options.maxAttempts) {
        if (lastError) throw lastError
        return
      }

      notify?.('reconnecting')
      const delay = Math.min(
        state.serverDelay ?? options.delay ?? 1000,
        options.maxDelay ?? MAX_TIMER_DELAY
      )
      const wait = waitForRetry(delay, config)

      if (wait) await wait
      throwIfAborted(config)
      attempts += 1

      try {
        current = await connect()
      } catch (error) {
        if (!isRetryableDisconnect(error)) {
          throw error
        }
        lastError = error
      }
    }
  })(), () => first.data?.[Symbol.asyncIterator]().return?.())
}

function isRetryableDisconnect(error: unknown): boolean {
  return isRequestError(error) && (
    error.code === 'NETWORK_ERROR' ||
    error.code === 'TIMEOUT_ERROR' ||
    (error.code === 'PARSER_ERROR' &&
      error.message === 'Failed to parse streaming response')
  )
}

function invalidReconnect(config: RequestConfig): RequestError {
  return new RequestError('Invalid SSE reconnect options', {
    code: 'CONFIG_ERROR',
    config
  })
}

function observerFor(state: ReconnectState) {
  return {
    initialId: state.lastEventId,
    initialRetry: state.serverDelay,
    onId(id: string) { state.lastEventId = id },
    onRetry(milliseconds: number) { state.serverDelay = milliseconds }
  }
}

function reconnectConfig(
  config: Omit<RequestConfig, 'url'>,
  lastEventId: string | undefined
): Omit<RequestConfig, 'url'> {
  const headers = new Headers(config.headers)
  const removeHeaders = [...config.removeHeaders ?? []]

  if (lastEventId !== undefined) {
    if (lastEventId) {
      headers.set('last-event-id', lastEventId)
      for (let index = removeHeaders.length - 1; index >= 0; index -= 1) {
        if (removeHeaders[index]?.toLowerCase() === 'last-event-id') {
          removeHeaders.splice(index, 1)
        }
      }
    } else {
      headers.delete('last-event-id')
      removeHeaders.push('last-event-id')
    }
  }

  return { ...config, headers, removeHeaders }
}
