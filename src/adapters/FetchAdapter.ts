import { isRequestError, RequestError } from '../errors'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import {
  type BuiltRequest,
  finalizeStreamingResponse,
  limitResponseSize,
  isBodylessResponse,
  isStreamingResponseType,
  parseResponse,
  resolveResponseType,
  validateRequestConfig
} from '../utils'
import { buildRequestWithHeaders } from '../utils/buildRequest'
import {
  createAbortError,
  throwIfAborted
} from '../utils/createAbortError'
import { validateResponseStatus } from '../utils/validateResponseStatus'
import { resolveErrorResponseSizeLimit } from '../utils/errorResponseSize'
import {
  ERROR_RESPONSE_DATA_UNAVAILABLE,
  withErrorResponseTimeout
} from '../utils/errorResponseTimeout'

export class FetchAdapter implements Adapter {
  async request<T = unknown>(
    config: RequestConfig
  ): Promise<NporaResponse<T>> {
    return this.execute<T>(
      config,
      validateRequestConfig(config, true)!,
      true
    )
  }

  requestValidated<T = unknown>(
    config: RequestConfig,
    validatedHeaders: Headers,
    preserveRaw = true
  ): Promise<NporaResponse<T>> {
    return this.execute<T>(
      config,
      validatedHeaders,
      preserveRaw
    )
  }

  private async execute<T>(
    config: RequestConfig,
    headers: Headers,
    preserveRaw: boolean
  ): Promise<NporaResponse<T>> {
    let request: BuiltRequest | undefined
    let deferCleanup = false
    let responseExposed = false

    try {
      throwIfAborted(config)

      request = buildRequestWithHeaders(config, headers)
      const fetchImplementation = config.fetch ?? globalThis.fetch
      let response = await fetchImplementation(request.url, request.init)
      const filteredResponse =
        response.type === 'opaque' ||
        response.type === 'opaqueredirect'
      const validStatus =
        response.type === 'error'
          ? false
          : filteredResponse && config.validateStatus === undefined
          ? true
          : validateResponseStatus(response.status, config)
      const bodyless = isBodylessResponse(
        config.method,
        response.status,
        response.type
      )

      if (!bodyless && (preserveRaw || !validStatus)) {
        response = limitResponseSize(response, config)
      }

      const responseType = bodyless
        ? undefined
        : resolveResponseType(response, config)
      const streaming = isStreamingResponseType(responseType)
      const errorResponseSizeLimit =
        !validStatus && !bodyless && !streaming
          ? resolveErrorResponseSizeLimit(config)
          : undefined

      if (streaming) {
        response = finalizeStreamingResponse(
          response,
          request.init.signal,
          config,
          request.clear
        )
        deferCleanup = Boolean(response.body)
      }

      const knownErrorBodyTooLarge =
        errorResponseSizeLimit !== undefined &&
        exceedsContentLength(response, errorResponseSizeLimit)
      const parseTarget =
        bodyless ||
        knownErrorBodyTooLarge ||
        streaming ||
        !validStatus ||
        !preserveRaw
          ? response
          : response.clone()
      let data: T

      if (bodyless || knownErrorBodyTooLarge) {
        data = undefined as T

        if (knownErrorBodyTooLarge) {
          cancelResponseBody(response)
        }
      } else {
        try {
          const parsed = !validStatus
            ? await withErrorResponseTimeout(
                config,
                signal => parseResponse<T>(
                  parseTarget,
                  config,
                  responseType,
                  errorResponseSizeLimit ?? config.maxResponseSize,
                  signal
                ),
                () => cancelResponseBody(response)
              )
            : await parseResponse<T>(
                parseTarget,
                config,
                responseType
              )

          data = parsed === ERROR_RESPONSE_DATA_UNAVAILABLE
            ? undefined as T
            : parsed
        } catch (error) {
          if (config.signal?.aborted) {
            throw createAbortError(config.signal.reason, config, error)
          }

          if (
            !validStatus &&
            request.init.signal?.aborted
          ) {
            throw createAbortError(
              request.init.signal.reason,
              config,
              error
            )
          }

          if (
            errorResponseSizeLimit === undefined ||
            !isRequestError(error) ||
            error.code !== 'RESPONSE_TOO_LARGE'
          ) {
            throw error
          }

          data = undefined as T
          cancelResponseBody(response)
        }
      }
      const nporaResponse: NporaResponse<T> = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config,
        raw: response
      }

      responseExposed = true

      if (!validStatus) {
        throw new RequestError<T>(response.statusText || 'Request failed', {
          code: 'HTTP_ERROR',
          response: nporaResponse
        })
      }

      return nporaResponse
    } catch (error) {
      if (isRequestError(error)) {
        throw error
      }

      const requestSizeError = request?.bodyError?.current

      if (requestSizeError) {
        throw requestSizeError
      }

      if (!request) {
        throw new RequestError('Failed to build request', {
          code: 'CONFIG_ERROR',
          config,
          cause: error
        })
      }

      const signal = request.init.signal
      const reason = signal?.reason

      if (signal?.aborted) {
        throw createAbortError(reason, config, error)
      }

      throw new RequestError('Network request failed', {
        code: 'NETWORK_ERROR',
        config,
        cause: error
      })
    } finally {
      if (!deferCleanup || !responseExposed) {
        request?.clear()
      }
    }
  }
}

function exceedsContentLength(response: Response, limit: number): boolean {
  const contentLength = Number(response.headers.get('content-length'))

  return Number.isFinite(contentLength) && contentLength > limit
}

function cancelResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => {
    // The HTTP error and its metadata remain authoritative.
  })
}
