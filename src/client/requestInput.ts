import type { HttpMethod, RequestConfig } from '../types'
import { rememberRequestBody } from '../utils/isRequest'

export function requestToConfig(
  input: Request,
  body: ReadableStream<Uint8Array> | null = input.body
): RequestConfig {
  const config: RequestConfig = {
    url: input.url,
    method: input.method as HttpMethod,
    headers: input.headers,
    body,
    signal: input.signal,
    fetchOptions: {
      cache: input.cache,
      credentials: input.credentials,
      integrity: input.integrity,
      keepalive: input.keepalive,
      mode: input.mode,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy
    }
  }

  rememberRequestBody(config, input, body)
  return config
}
