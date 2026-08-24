import { RequestError } from '../errors'
import { createAbortError } from '../utils/createAbortError'
import type {
  NporaResponse,
  RequestConfig
} from '../types'
import {
  createTransferProgressTracker,
  type TransferProgressSnapshot
} from './transferProgress'
import {
  buildRequest,
  isBodylessResponse,
  parseResponse,
  resolveResponseType
} from '../utils'
import type { ResponseType } from '../types'
import { validateResponseStatus } from '../utils/validateResponseStatus'

type TransferProgress = TransferProgressSnapshot

export interface XHRTransportOptions {
  onDownloadProgress?: (progress: TransferProgress) => void
  onUploadProgress?: (progress: TransferProgress) => void
  preserveRaw?: boolean
}

export function xhrRequest<T>(
  config: RequestConfig,
  options: XHRTransportOptions = {}
): Promise<NporaResponse<T>> {
  let request: ReturnType<typeof buildRequest> | undefined
  let xhr: XMLHttpRequest

  try {
    request = buildRequest(config)
    xhr = new XMLHttpRequest()
  } catch (error) {
    request?.clear()

    return Promise.reject(
      createConfigError(config, error)
    )
  }

  const signal = request.init.signal

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      try {
        signal?.removeEventListener('abort', onSignalAbort)
      } catch {
        // Cleanup failures must not retain an XHR request.
      }
      request.clear()
      xhr.onload = null
      xhr.onerror = null
      xhr.onabort = null
      xhr.onprogress = null

      if (xhr.upload) {
        xhr.upload.onprogress = null
      }
    }

    const resolveOnce = (response: NporaResponse<T>) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(response)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }

    const abortWith = (error: unknown) => {
      if (settled) {
        return
      }

      rejectOnce(error)
      xhr.abort()
    }

    const onSignalAbort = () => {
      abortWith(
        createAbortError(signal?.reason, config)
      )
    }

    xhr.onload = () => {
      void processResponse<T>(xhr, config, options.preserveRaw ?? true).then(
        resolveOnce,
        rejectOnce
      )
    }
    xhr.onerror = () => {
      rejectOnce(
        new RequestError('Network request failed', {
          code: 'NETWORK_ERROR',
          config
        })
      )
    }
    xhr.onabort = () => {
      rejectOnce(
        createAbortError(signal?.reason, config)
      )
    }
    xhr.onprogress = createProgressHandler(
      options.onDownloadProgress,
      abortWith,
      config.maxResponseSize,
      config
    )

    if (xhr.upload) {
      xhr.upload.onprogress = createProgressHandler(
        options.onUploadProgress,
        abortWith
      )
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

      new Headers(request.init.headers).forEach(
        (value, name) => {
          xhr.setRequestHeader(name, value)
        }
      )

      if (signal?.aborted) {
        onSignalAbort()
        return
      }

      signal?.addEventListener('abort', onSignalAbort, {
        once: true
      })

      if (settled) {
        return
      }

      const body = request.init.body

      if (
        typeof ReadableStream !== 'undefined' &&
        body instanceof ReadableStream
      ) {
        abortWith(
          new RequestError(
            'XMLHttpRequest cannot send a ReadableStream body',
            {
              code: 'CONFIG_ERROR',
              config
            }
          )
        )
        return
      }

      xhr.send(body as XMLHttpRequestBodyInit | null)
    } catch (error) {
      abortWith(createConfigError(config, error))
    }
  })
}

async function processResponse<T>(
  xhr: XMLHttpRequest,
  config: RequestConfig,
  preserveRaw: boolean
): Promise<NporaResponse<T>> {
  if (xhr.status === 0) {
    throw new RequestError('Network request failed', {
      code: 'NETWORK_ERROR',
      config
    })
  }

  try {
    const headers = parseHeaders(
      xhr.getAllResponseHeaders()
    )
    const blob =
      xhr.response instanceof Blob
        ? xhr.response
        : new Blob(
            xhr.response === null
              ? []
              : [xhr.response],
            {
              type: headers.get('content-type') ?? ''
            }
          )
    const bodyless = isBodylessResponse(undefined, xhr.status)
    const validStatus = validateResponseStatus(xhr.status, config)
    const responseInit = {
      status: xhr.status,
      statusText: xhr.statusText,
      headers
    }
    const emptyRaw = new Response(null, responseInit)
    const responseType = bodyless
      ? undefined
      : resolveResponseType(emptyRaw, config)
    const directBuffered =
      !Number.isFinite(config.maxResponseSize)
      && isBufferedResponseType(responseType)
    const raw =
      bodyless || (directBuffered && !preserveRaw && validStatus)
        ? emptyRaw
        : new Response(blob, responseInit)
    const parseTarget =
      bodyless ||
      directBuffered ||
      config.responseType === 'stream' ||
      !preserveRaw
        ? raw
        : raw.clone()
    const data = bodyless
      ? undefined as T
      : directBuffered
        ? await parseBufferedBlob<T>(blob, responseType, raw, config)
        : await parseResponse<T>(parseTarget, config)
    const response: NporaResponse<T> = {
      data,
      status: xhr.status,
      statusText: xhr.statusText,
      headers,
      config,
      raw
    }
    if (!validStatus) {
      throw new RequestError(
        xhr.statusText || 'Request failed',
        {
          code: 'HTTP_ERROR',
          response
        }
      )
    }

    return response
  } catch (error) {
    if (error instanceof RequestError) {
      throw error
    }

    throw new RequestError(
      'Failed to process XMLHttpRequest response',
      {
        code: 'PARSER_ERROR',
        config,
        cause: error
      }
    )
  }
}

function isBufferedResponseType(
  type: ResponseType | undefined
): type is 'json' | 'text' | 'blob' | 'arrayBuffer' {
  return type === 'json' ||
    type === 'text' ||
    type === 'blob' ||
    type === 'arrayBuffer'
}

async function parseBufferedBlob<T>(
  blob: Blob,
  type: 'json' | 'text' | 'blob' | 'arrayBuffer',
  response: Response,
  config: RequestConfig
): Promise<T> {
  try {
    switch (type) {
      case 'json':
        return JSON.parse(await blob.text()) as T

      case 'text':
        return await blob.text() as T

      case 'arrayBuffer':
        return await blob.arrayBuffer() as T

      default: {
        const contentType = response.headers.get('content-type') ?? ''

        return (
          !contentType || blob.type === contentType
            ? blob
            : new Blob([blob], { type: contentType })
        ) as T
      }
    }
  } catch (error) {
    throw new RequestError('Failed to parse response', {
      code: 'PARSER_ERROR',
      status: response.status,
      config,
      cause: error
    })
  }
}

function createProgressHandler(
  callback: ((progress: TransferProgress) => void) | undefined,
  abortWith: (error: unknown) => void,
  maxResponseSize?: number,
  config?: RequestConfig
): ((event: ProgressEvent<EventTarget>) => void) | null {
  if (!callback && !Number.isFinite(maxResponseSize)) {
    return null
  }

  const trackProgress = callback
    ? createTransferProgressTracker()
    : undefined

  return event => {
    if (
      Number.isFinite(maxResponseSize) &&
      event.loaded > (maxResponseSize ?? Number.POSITIVE_INFINITY)
    ) {
      abortWith(
        new RequestError(
          `Response body exceeds maxResponseSize ${maxResponseSize}`,
          {
            code: 'RESPONSE_TOO_LARGE',
            config
          }
        )
      )
      return
    }

    if (!callback || !trackProgress) {
      return
    }

    try {
      callback(
        trackProgress(
          event.loaded,
          event.lengthComputable
            ? event.total
            : undefined
        )
      )
    } catch (error) {
      abortWith(error)
    }
  }
}

function parseHeaders(value: string): Headers {
  const headers = new Headers()

  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(':')

    if (separator > 0) {
      headers.append(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim()
      )
    }
  }

  return headers
}

function createConfigError(
  config: RequestConfig,
  cause: unknown
): RequestError {
  return new RequestError(
    'Failed to create XMLHttpRequest',
    {
      code: 'CONFIG_ERROR',
      config,
      cause
    }
  )
}
