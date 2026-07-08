import type { Adapter } from './Adapter'
import { RequestError } from '../errors'
import type { NovaResponse, RequestConfig } from '../types'
import type { RequestContext } from '../core'
import { createFetchRequest } from './createFetchRequest'

export class FetchAdapter implements Adapter {
  async request<T>(context: RequestContext<T>): Promise<void> {
    const fetchRequest = createFetchRequest(context.config)

    try {
      const raw = await fetch(fetchRequest.url, fetchRequest.init)

      const data = await parseResponse<T>(raw, context.config)

      const response: NovaResponse<T> = {
        data,
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        config: context.config,
        raw
      }

      context.response = response

      const validateStatus =
        context.config.validateStatus ?? defaultValidateStatus

      if (!validateStatus(raw.status)) {
        context.error = new RequestError(raw.statusText || 'Request failed', {
          status: raw.status,
          code: 'HTTP_ERROR'
        })
      }
    } catch (error) {
      if (error instanceof RequestError) {
        context.error = error
        return
      }

      const abortReason = fetchRequest.getAbortReason()

      if (abortReason instanceof RequestError) {
        context.error = abortReason
        return
      }

      if (fetchRequest.init.signal?.aborted) {
        context.error = new RequestError('Request aborted', {
          code: 'ABORT_ERROR',
          cause: error
        })
        return
      }

      context.error = new RequestError('Network request failed', {
        code: 'NETWORK_ERROR',
        cause: error
      })
    } finally {
      fetchRequest.clear()
      context.endTime = Date.now()
    }
  }
}

function defaultValidateStatus(status: number): boolean {
  return status >= 200 && status < 300
}

async function parseResponse<T>(
  response: Response,
  config: RequestConfig
): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const responseType = config.responseType ?? detectResponseType(response)

  switch (responseType) {
    case 'json':
      return response.json() as Promise<T>

    case 'text':
      return response.text() as Promise<T>

    case 'blob':
      return response.blob() as Promise<T>

    case 'arrayBuffer':
      return response.arrayBuffer() as Promise<T>

    case 'stream':
      return response.body as T

    default:
      return response.text() as Promise<T>
  }
}

function detectResponseType(response: Response): RequestConfig['responseType'] {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return 'json'
  }

  return 'text'
}
