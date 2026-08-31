import { isRequestError, RequestError } from '../errors'
import type { RequestConfig } from '../types'

const DEFAULT_ERROR_RESPONSE_TIMEOUT = 10_000

export const ERROR_RESPONSE_DATA_UNAVAILABLE = Symbol(
  'ERROR_RESPONSE_DATA_UNAVAILABLE'
)

/** Bound error-body reads and asynchronous parsers without weakening aborts. */
export async function withErrorResponseTimeout<T>(
  config: RequestConfig,
  operation: (signal: AbortSignal) => Promise<T>,
  cancel?: () => void
): Promise<T | typeof ERROR_RESPONSE_DATA_UNAVAILABLE> {
  const configuredTimeout = config.timeout ?? 0
  const timeout = configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_ERROR_RESPONSE_TIMEOUT
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timerFired = false
  let operationPromise: Promise<T> | undefined

  const cancelOperation = () => {
    try {
      cancel?.()
    } catch {
      // Cancellation is best-effort and must not replace the stable outcome.
    }

    controller.abort()
  }

  try {
    const timeoutPromise = new Promise<typeof ERROR_RESPONSE_DATA_UNAVAILABLE>(
      (resolve, reject) => {
        timer = setTimeout(() => {
          timerFired = true
          cancelOperation()

          if (configuredTimeout > 0) {
            reject(new RequestError(
              `Request timeout after ${configuredTimeout}ms`,
              {
                code: 'TIMEOUT_ERROR',
                config
              }
            ))
            return
          }

          resolve(ERROR_RESPONSE_DATA_UNAVAILABLE)
        }, timeout)
      }
    )

    operationPromise = operation(controller.signal)

    try {
      return await Promise.race([
        operationPromise,
        timeoutPromise
      ])
    } catch (error) {
      if (isRequestError(error) && error.code === 'PARSER_ERROR') {
        return ERROR_RESPONSE_DATA_UNAVAILABLE
      }

      throw error
    }
  } finally {
    if (timer !== undefined && !timerFired) {
      clearTimeout(timer)
    }

    void operationPromise?.catch(() => {
      // A timed-out custom parser may settle after the caller has continued.
    })
  }
}
