import { RequestError } from '../errors'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import {
  type BuiltRequest,
  finalizeStreamingResponse,
  limitResponseSize,
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
      let response = await fetch(request.url, request.init)
      const validStatus = validateResponseStatus(response.status, config)

      if (preserveRaw || !validStatus) {
        response = limitResponseSize(response, config)
      }

      const responseType = resolveResponseType(response, config)
      const streaming = isStreamingResponseType(responseType)
      const bodyless =
        config.method === 'HEAD' ||
        response.status === 204 ||
        response.status === 205 ||
        response.status === 304

      if (streaming) {
        response = finalizeStreamingResponse(
          response,
          request.init.signal,
          config,
          request.clear
        )
        deferCleanup = Boolean(response.body)
      }

      const parseTarget =
        bodyless ||
        streaming ||
        (
          !preserveRaw &&
          validStatus
        )
          ? response
          : response.clone()
      const data = await parseResponse<T>(
        parseTarget,
        config,
        responseType
      )
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
      if (error instanceof RequestError) {
        throw error
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
