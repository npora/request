import { RequestError } from '../errors'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import {
  type BuiltRequest,
  limitResponseSize,
  parseResponse,
  validateRequestConfig
} from '../utils'
import { buildRequestWithHeaders } from '../utils/buildRequest'

export class FetchAdapter implements Adapter {
  async request<T = unknown>(
    config: RequestConfig
  ): Promise<NporaResponse<T>> {
    return this.execute<T>(
      config,
      validateRequestConfig(config),
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

    try {
      request = buildRequestWithHeaders(config, headers)
      const response = limitResponseSize(
        await fetch(request.url, request.init),
        config
      )
      const validateStatus = config.validateStatus ?? defaultValidateStatus
      const validStatus = validateStatus(response.status)
      const parseTarget =
        config.responseType === 'stream' ||
        (
          !preserveRaw &&
          validStatus
        )
          ? response
          : response.clone()
      const data = await parseResponse<T>(parseTarget, config)
      const nporaResponse: NporaResponse<T> = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config,
        raw: response
      }

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
        if (reason instanceof RequestError) {
          throw new RequestError(reason.message, {
            code: reason.code,
            status: reason.status,
            data: reason.data,
            response: reason.response,
            config: reason.config ?? config,
            cause: reason
          })
        }

        throw new RequestError('Request aborted', {
          code: 'ABORT_ERROR',
          config,
          cause: error
        })
      }

      throw new RequestError('Network request failed', {
        code: 'NETWORK_ERROR',
        config,
        cause: error
      })
    } finally {
      request?.clear()
    }
  }
}

function defaultValidateStatus(status: number): boolean {
  return status >= 200 && status < 300
}
