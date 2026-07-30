import { RequestError } from '../errors'
import type {
  DownloadProgress,
  NporaResponse,
  RequestConfig
} from '../types'
import { buildRequest } from '../utils'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export type DownloadTransport = 'auto' | 'fetch' | 'xhr'

export interface DownloadPluginOptions {
  /**
   * Download progress transport.
   *
   * `auto` prefers Fetch response streams and falls back to XMLHttpRequest
   * when streaming responses are unavailable.
   *
   * @default auto
   */
  transport?: DownloadTransport
}

export function downloadPlugin(
  options: DownloadPluginOptions = {}
): Plugin {
  const xhrContexts = new WeakSet<object>()

  return {
    name: 'download',

    install(context) {
      context.interceptors.request.use(config => {
        const download = resolveExtensionConfig(
          config,
          'download',
          config.download
        )

        if (!download) {
          return config
        }

        const responseType =
          download.onProgress &&
          !shouldUseXHR(options.transport)
            ? 'stream'
            : config.responseType ?? 'blob'

        return {
          ...config,
          responseType
        }
      })

      context.hooks.onRequest(async requestContext => {
        if (requestContext.response) {
          return
        }

        const download = resolveExtensionConfig(
          requestContext.config,
          'download',
          requestContext.config.download
        )
        const onProgress = download?.onProgress

        if (
          !onProgress ||
          !shouldUseXHR(options.transport)
        ) {
          return
        }

        if (typeof XMLHttpRequest === 'undefined') {
          throw new RequestError(
            'XMLHttpRequest is unavailable for download progress',
            {
              code: 'CONFIG_ERROR',
              config: requestContext.config
            }
          )
        }

        requestContext.response = await downloadWithXHR(
          requestContext.config,
          onProgress
        )
        xhrContexts.add(requestContext)
      })

      context.hooks.onResponse(async requestContext => {
        if (xhrContexts.has(requestContext)) {
          return
        }

        const response = requestContext.response

        if (!response) {
          return
        }

        const download = resolveExtensionConfig(
          response.config,
          'download',
          response.config.download
        )
        const onProgress = download?.onProgress

        if (!download || !onProgress) {
          return
        }

        const stream = response.data

        if (
          typeof ReadableStream === 'undefined' ||
          !(stream instanceof ReadableStream)
        ) {
          throw new RequestError(
            'Download response stream is unavailable',
            {
              code: 'PARSER_ERROR',
              status: response.status,
              config: response.config
            }
          )
        }

        const blob = await consumeDownloadStream(
          stream,
          response,
          onProgress
        )

        requestContext.response = {
          ...response,
          data: blob
        }
      })
    }
  }
}

function shouldUseXHR(
  transport: DownloadTransport = 'auto'
): boolean {
  if (transport === 'xhr') {
    return true
  }

  if (transport === 'fetch') {
    return false
  }

  return (
    !supportsFetchResponseStream() &&
    typeof XMLHttpRequest !== 'undefined'
  )
}

function supportsFetchResponseStream(): boolean {
  return (
    typeof ReadableStream !== 'undefined' &&
    typeof Response !== 'undefined' &&
    'body' in Response.prototype
  )
}

function downloadWithXHR(
  config: RequestConfig,
  onProgress: (progress: DownloadProgress) => void
): Promise<NporaResponse<Blob>> {
  let request: ReturnType<typeof buildRequest> | undefined
  let xhr: XMLHttpRequest

  try {
    request = buildRequest(config)
    xhr = new XMLHttpRequest()
  } catch (error) {
    request?.clear()

    return Promise.reject(
      new RequestError(
        'Failed to create XMLHttpRequest download',
        {
          code: 'CONFIG_ERROR',
          config,
          cause: error
        }
      )
    )
  }

  const signal = request.init.signal

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      signal?.removeEventListener('abort', onSignalAbort)
      request.clear()
      xhr.onload = null
      xhr.onerror = null
      xhr.onabort = null
      xhr.onprogress = null
    }

    const settle = (
      handler: typeof resolve | typeof reject,
      value: NporaResponse<Blob> | unknown
    ) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      handler(value as NporaResponse<Blob>)
    }

    const settleError = (error: unknown) => {
      settle(reject, error)
    }

    const onSignalAbort = () => {
      const error = createXHRAbortError(
        signal?.reason,
        config
      )

      settleError(error)
      xhr.abort()
    }

    xhr.onload = () => {
      try {
        if (xhr.status === 0) {
          settleError(
            new RequestError('Network request failed', {
              code: 'NETWORK_ERROR',
              config
            })
          )
          return
        }

        const headers = parseXHRHeaders(
          xhr.getAllResponseHeaders()
        )
        const data =
          xhr.response instanceof Blob
            ? xhr.response
            : new Blob(
                xhr.response === null
                  ? []
                  : [xhr.response],
                {
                  type:
                    headers.get('content-type') ?? ''
                }
              )
        const response: NporaResponse<Blob> = {
          data,
          status: xhr.status,
          statusText: xhr.statusText,
          headers,
          config,
          raw: new Response(
            isNullBodyStatus(xhr.status)
              ? null
              : data,
            {
              status: xhr.status,
              statusText: xhr.statusText,
              headers
            }
          )
        }
        const validateStatus =
          config.validateStatus ?? defaultValidateStatus

        if (!validateStatus(xhr.status)) {
          settleError(
            new RequestError(
              xhr.statusText || 'Request failed',
              {
                code: 'HTTP_ERROR',
                response
              }
            )
          )
          return
        }

        settle(resolve, response)
      } catch (error) {
        settleError(
          error instanceof RequestError
            ? error
            : new RequestError(
                'Failed to process XMLHttpRequest download',
                {
                  code: 'PARSER_ERROR',
                  config,
                  cause: error
                }
              )
        )
      }
    }

    xhr.onerror = () => {
      settleError(
        new RequestError('Network request failed', {
          code: 'NETWORK_ERROR',
          config
        })
      )
    }

    xhr.onabort = () => {
      settleError(
        createXHRAbortError(signal?.reason, config)
      )
    }

    xhr.onprogress = event => {
      try {
        onProgress(
          createProgress(
            event.loaded,
            event.lengthComputable
              ? event.total
              : undefined
          )
        )
      } catch (error) {
        settleError(error)
        xhr.abort()
      }
    }

    try {
      xhr.open(
        request.init.method ?? 'GET',
        request.url,
        true
      )
      xhr.responseType = 'blob'
      xhr.withCredentials =
        request.init.credentials === 'include'

      const headers = new Headers(request.init.headers)

      headers.forEach((value, name) => {
        xhr.setRequestHeader(name, value)
      })

      if (signal?.aborted) {
        onSignalAbort()
        return
      }

      signal?.addEventListener('abort', onSignalAbort, {
        once: true
      })

      const body = request.init.body

      if (
        typeof ReadableStream !== 'undefined' &&
        body instanceof ReadableStream
      ) {
        settleError(
          new RequestError(
            'XMLHttpRequest cannot send a ReadableStream body',
            {
              code: 'CONFIG_ERROR',
              config
            }
          )
        )
        xhr.abort()
        return
      }

      xhr.send(body as XMLHttpRequestBodyInit | null)
    } catch (error) {
      settleError(
        new RequestError(
          'Failed to create XMLHttpRequest download',
          {
            code: 'CONFIG_ERROR',
            config,
            cause: error
          }
        )
      )
    }
  })
}

function parseXHRHeaders(value: string): Headers {
  const headers = new Headers()

  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(':')

    if (separator <= 0) {
      continue
    }

    headers.append(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim()
    )
  }

  return headers
}

function createXHRAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  if (reason instanceof RequestError) {
    return new RequestError(reason.message, {
      code: reason.code,
      status: reason.status,
      data: reason.data,
      response: reason.response,
      config: reason.config ?? config,
      cause: reason
    })
  }

  return new RequestError('Request aborted', {
    code: 'ABORT_ERROR',
    config,
    cause: reason
  })
}

function defaultValidateStatus(status: number): boolean {
  return status >= 200 && status < 300
}

function isNullBodyStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

async function consumeDownloadStream(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  response: NporaResponse,
  onProgress: (progress: DownloadProgress) => void
): Promise<Blob> {
  const reader = stream.getReader()
  const chunks: ArrayBuffer[] = []

  const total = parseContentLength(
    response.headers.get('content-length')
  )

  let loaded = 0

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) {
        break
      }

      const chunk = result.value
      const buffer = toDownloadBuffer(chunk)

      chunks.push(buffer)
      loaded += chunk.byteLength

      onProgress(createProgress(loaded, total))
    }
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      // Preserve the original stream/progress failure.
    }

    throw error
  } finally {
    reader.releaseLock()
  }

  return new Blob(chunks, {
    type: response.headers.get('content-type') ?? ''
  })
}

/**
 * Reuses complete ArrayBuffer chunks and copies only sliced or
 * SharedArrayBuffer-backed views before passing them to Blob.
 */
function toDownloadBuffer(
  chunk: Uint8Array<ArrayBufferLike>
): ArrayBuffer {
  if (chunk.buffer instanceof ArrayBuffer) {
    if (
      chunk.byteOffset === 0 &&
      chunk.byteLength === chunk.buffer.byteLength
    ) {
      return chunk.buffer
    }

    return chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength
    )
  }

  const copy = new Uint8Array(chunk.byteLength)

  copy.set(chunk)

  return copy.buffer
}

function parseContentLength(
  value: string | null
): number | undefined {
  if (!value) {
    return undefined
  }

  const total = Number(value)

  if (!Number.isFinite(total) || total < 0) {
    return undefined
  }

  return total
}

function createProgress(
  loaded: number,
  total?: number
): DownloadProgress {
  if (total === undefined || total === 0) {
    return {
      loaded,
      total
    }
  }

  return {
    loaded,
    total,
    progress: Math.min(loaded / total, 1)
  }
}
