import { RequestError } from '../errors'
import type { RequestConfig, ResponseType } from '../types'

/**
 * Parse a Fetch response according to the request configuration.
 */
export async function parseResponse<T = unknown>(
  response: Response,
  config: RequestConfig
): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const responseType =
    config.responseType ?? detectResponseType(response)

  try {
    switch (responseType) {
      case 'json':
        return (await response.json()) as T

      case 'text':
        return (await response.text()) as T

      case 'blob':
        return (await response.blob()) as T

      case 'arrayBuffer':
        return (await response.arrayBuffer()) as T

      case 'stream':
        return response.body as T

      default:
        return (await response.text()) as T
    }
  } catch (error) {
    throw new RequestError('Failed to parse response', {
      code: 'PARSER_ERROR',
      status: response.status,
      cause: error
    })
  }
}

function detectResponseType(response: Response): ResponseType {
  const contentType = response.headers.get('content-type') ?? ''

  if (
    contentType.includes('application/json') ||
    contentType.includes('+json')
  ) {
    return 'json'
  }

  return 'text'
}
