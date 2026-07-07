import type { Adapter } from './Adapter'
import { RequestError } from '../errors'
import type { NovaResponse } from '../types'
import type { RequestContext } from '../core'
import { createFetchRequest } from './createFetchRequest'

/**
 * Fetch Adapter
 *
 * 基于 Fetch API 的默认请求适配器。
 */
export class FetchAdapter implements Adapter {
  /**
   * 执行请求。
   */
  async request<T>(context: RequestContext<T>): Promise<void> {
    try {
      const { url, init } = createFetchRequest(context.config)

      const raw = await fetch(url, init)

      const data = await parseResponse<T>(raw)

      const response: NovaResponse<T> = {
        data,
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        config: context.config,
        raw
      }

      context.response = response

      if (!raw.ok) {
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
      context.error = new RequestError('Network request failed', {
        code: 'NETWORK_ERROR',
        cause: error
      })
    } finally {
      context.endTime = Date.now()
    }
  }
}

/**
 * 解析 Fetch Response。
 */
async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (response.status === 204) {
    return undefined as T
  }

  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>
  }

  return response.text() as Promise<T>
}