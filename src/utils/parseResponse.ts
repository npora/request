import type { RequestConfig } from '../types'

export async function parseResponse<T = unknown>(
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
