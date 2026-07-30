import { RequestError } from '../errors'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import {
  buildRequest,
  type BuiltRequest,
  parseResponse,
  validateRequestConfig
} from '../utils'

export class FetchAdapter implements Adapter {
  async request<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    let request: BuiltRequest | undefined

    try {
      validateRequestConfig(config)
      request = buildRequest(config)
      const response = await fetch(request.url, request.init)
      const validateStatus = config.validateStatus ?? defaultValidateStatus
      const parseTarget =
        config.responseType === 'stream'
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

      if (!validateStatus(response.status)) {
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
