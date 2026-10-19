import type { RequestConfig } from '../types'

/** Classify responses that cannot expose an HTTP message body. */
export function isBodylessResponse(
  method: RequestConfig['method'],
  status: number,
  responseType?: Response['type']
): boolean {
  return method === 'HEAD' ||
    status === 204 ||
    status === 205 ||
    status === 304 ||
    responseType === 'opaque' ||
    responseType === 'opaqueredirect' ||
    responseType === 'error'
}

