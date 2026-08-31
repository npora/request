import type { RequestConfig } from '../types/config'

const NATIVE_REQUEST = Symbol('nativeRequest')

interface NativeRequestState {
  request: Request
  body: ReadableStream<Uint8Array> | null
}

type RequestConfigWithNativeInput = RequestConfig & {
  [NATIVE_REQUEST]?: NativeRequestState
}

/** Detect native Request values across realms without cloning their body. */
export function isRequest(value: unknown): value is Request {
  if (typeof Request === 'undefined') {
    return false
  }

  const getter = Object.getOwnPropertyDescriptor(
    Request.prototype,
    'url'
  )?.get

  if (!getter) {
    return false
  }

  try {
    getter.call(value)
    return true
  } catch {
    return false
  }
}

/** Preserve the native transport path for an unmodified Request body. */
export function rememberRequestBody(
  config: RequestConfig,
  request: Request,
  body: ReadableStream<Uint8Array> | null = request.body
): void {
  ;(config as RequestConfigWithNativeInput)[NATIVE_REQUEST] = {
    request,
    body
  }
}

export function getRequestForBody(
  config: RequestConfig,
  body: BodyInit | undefined
): Request | undefined {
  const state = (config as RequestConfigWithNativeInput)[NATIVE_REQUEST]

  return state && state.body === body ? state.request : undefined
}
