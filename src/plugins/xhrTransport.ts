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
  parseResponse
} from '../utils'
import { validateResponseStatus } from '../utils/validateResponseStatus'

type TransferProgress = TransferProgressSnapshot

export interface XHRTransportOptions {
  onDownloadProgress?: (progress: TransferProgress) => void
  onUploadProgress?: (progress: TransferProgress) => void
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
      signal?.removeEventListener('abort', onSignalAbort)
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
      rejectOnce(error)
      xhr.abort()
    }

    const onSignalAbort = () => {
      abortWith(
        createAbortError(signal?.reason, config)
      )
    }

    xhr.onload = () => {
      void processResponse<T>(xhr, config).then(
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
  config: RequestConfig
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
    const raw = new Response(
      isNullBodyStatus(xhr.status)
        ? null
        : blob,
      {
        status: xhr.status,
        statusText: xhr.statusText,
        headers
      }
    )
    const parseTarget =
      config.responseType === 'stream'
        ? raw
        : raw.clone()
    const data = await parseResponse<T>(
      parseTarget,
      config
    )
    const response: NporaResponse<T> = {
      data,
      status: xhr.status,
      statusText: xhr.statusText,
      headers,
      config,
      raw
    }
    if (!validateResponseStatus(xhr.status, config)) {
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

function isNullBodyStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}
