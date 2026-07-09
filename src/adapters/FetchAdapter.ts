import { buildRequest } from '../core'
import { RequestError } from '../errors'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import { parseResponse } from '../utils'

export class FetchAdapter implements Adapter {
  async request<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    const request = buildRequest(config)

    try {
      const response = await fetch(request.url, request.init)
      const data = await parseResponse<T>(response, config)

      const validateStatus = config.validateStatus ?? defaultValidateStatus

      if (!validateStatus(response.status)) {
        throw new RequestError(response.statusText || 'Request failed', {
          code: 'HTTP_ERROR',
          status: response.status
        })
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config,
        raw: response
      }
    } catch (error) {
      if (error instanceof RequestError) {
        throw error
      }

      if (request.init.signal?.aborted) {
        throw new RequestError('Request aborted', {
          code: 'ABORT_ERROR',
          cause: error
        })
      }

      throw new RequestError('Network request failed', {
        code: 'NETWORK_ERROR',
        cause: error
      })
    } finally {
      request.clear()
    }
  }
}

function defaultValidateStatus(status: number): boolean {
  return status >= 200 && status < 300
}
