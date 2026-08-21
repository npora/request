import { RequestError } from '../errors'
import type { RequestConfig, ResponseType } from '../types'
import {
  parseNdjson,
  parseServerSentEvents
} from './parseStreamingResponse'

const TEXT_DECODER = new TextDecoder()

/**
 * Bound a Fetch response before it can be cloned into multiple body branches.
 */
export function limitResponseSize(
  response: Response,
  config: RequestConfig
): Response {
  const maxSize = config.maxResponseSize

  if (
    maxSize === undefined ||
    !Number.isFinite(maxSize) ||
    !response.body
  ) {
    return response
  }

  const contentLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    const error = createSizeError(response, maxSize, config)

    void response.body.cancel(error).catch(() => {
      // Preserve the size-limit error.
    })

    throw error
  }

  const limited = new Response(
    limitResponseStream(response, maxSize, config),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    }
  )

  copyResponseMetadata(response, limited)

  return limited
}

/**
 * Keep request cancellation resources alive until a streaming response body
 * settles instead of releasing them as soon as response headers arrive.
 */
export function finalizeStreamingResponse(
  response: Response,
  signal: AbortSignal | null | undefined,
  config: RequestConfig,
  finalize: () => void
): Response {
  if (!response.body) {
    finalize()
    return response
  }

  const reader = response.body.getReader()
  let settled = false
  let pendingAbortError: unknown
  let onAbort: (() => void) | undefined

  const settle = () => {
    if (settled) {
      return
    }

    settled = true
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort)
      onAbort = undefined
    }
    reader.releaseLock()
    finalize()
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        const error = streamingReadError(signal?.reason, signal, config)

        pendingAbortError = error
        void reader.cancel(error).catch(() => {
          // Preserve the stable cancellation error.
        }).finally(() => {
          if (!settled) {
            settle()
            controller.error(error)
          }
        })
      }

      if (signal?.aborted) {
        onAbort()
      } else {
        signal?.addEventListener('abort', onAbort, {
          once: true
        })
      }
    },

    async pull(controller) {
      try {
        const result = await reader.read()

        if (pendingAbortError) {
          const error = pendingAbortError

          settle()
          controller.error(error)
          return
        }

        if (settled) {
          return
        }

        if (result.done) {
          settle()
          controller.close()
          return
        }

        controller.enqueue(result.value)
      } catch (error) {
        if (settled) {
          return
        }

        settle()
        controller.error(streamingReadError(error, signal, config))
      }
    },

    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        settle()
      }
    }
  })
  const wrapped = new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })

  copyResponseMetadata(response, wrapped)

  return wrapped
}

/**
 * Parse a Fetch response according to the request configuration.
 */
export async function parseResponse<T = unknown>(
  response: Response,
  config: RequestConfig
): Promise<T> {
  if (
    config.method === 'HEAD' ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    return undefined as T
  }

  const responseType = resolveResponseType(response, config)
  const maxSize = config.maxResponseSize

  try {
    if (maxSize !== undefined && Number.isFinite(maxSize)) {
      rejectOversizedContentLength(response, maxSize, config)

      if (isStreamingResponseType(responseType)) {
        const stream = limitResponseStream(response, maxSize, config)

        return parseStreamingResponse<T>(
          new Response(stream, response),
          responseType,
          config
        )
      }

      const bytes = await readLimitedBody(response, maxSize, config)

      return parseBufferedResponse<T>(bytes, responseType, response)
    }

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

      case 'sse':
        return parseServerSentEvents(response, config) as T

      case 'ndjson':
        return parseNdjson(response, config) as T

      default:
        return (await response.text()) as T
    }
  } catch (error) {
    if (error instanceof RequestError) {
      throw error
    }

    throw new RequestError('Failed to parse response', {
      code: 'PARSER_ERROR',
      status: response.status,
      config,
      cause: error
    })
  }
}

function rejectOversizedContentLength(
  response: Response,
  maxSize: number,
  config: RequestConfig
): void {
  const contentLength = Number(response.headers.get('content-length'))

  if (!Number.isFinite(contentLength) || contentLength <= maxSize) {
    return
  }

  const error = createSizeError(response, maxSize, config)

  void response.body?.cancel(error).catch(() => {
    // Preserve the size-limit error.
  })

  throw error
}

async function readLimitedBody(
  response: Response,
  maxSize: number,
  config: RequestConfig
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array()
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) {
        break
      }

      size += result.value.byteLength

      if (size > maxSize) {
        const error = createSizeError(response, maxSize, config)

        void reader.cancel(error).catch(() => {
          // Preserve the size-limit error.
        })
        throw error
      }

      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

function parseBufferedResponse<T>(
  bytes: Uint8Array,
  responseType: Exclude<ResponseType, 'stream' | 'sse' | 'ndjson'>,
  response: Response
): T {
  switch (responseType) {
    case 'json':
      return JSON.parse(TEXT_DECODER.decode(bytes)) as T

    case 'blob':
      return new Blob([toArrayBuffer(bytes)], {
        type: response.headers.get('content-type') ?? ''
      }) as T

    case 'arrayBuffer':
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as T

    default:
      return TEXT_DECODER.decode(bytes) as T
  }
}

function parseStreamingResponse<T>(
  response: Response,
  responseType: Extract<ResponseType, 'stream' | 'sse' | 'ndjson'>,
  config: RequestConfig
): T {
  switch (responseType) {
    case 'sse':
      return parseServerSentEvents(response, config) as T

    case 'ndjson':
      return parseNdjson(response, config) as T

    default:
      return response.body as T
  }
}

export function isStreamingResponseType(
  responseType: ResponseType | undefined
): responseType is Extract<ResponseType, 'stream' | 'sse' | 'ndjson'> {
  return responseType === 'stream' ||
    responseType === 'sse' ||
    responseType === 'ndjson'
}

export function resolveResponseType(
  response: Response,
  config: RequestConfig
): ResponseType {
  return config.responseType ?? detectResponseType(response)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    )
  }

  return Uint8Array.from(bytes).buffer
}

function limitResponseStream(
  response: Response,
  maxSize: number,
  config: RequestConfig
): ReadableStream<Uint8Array> | null {
  if (!response.body) {
    return null
  }

  const contentLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    const error = createSizeError(response, maxSize, config)

    void response.body.cancel(error).catch(() => {
      // Preserve the size-limit error.
    })

    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error)
      }
    })
  }

  const reader = response.body.getReader()
  let size = 0
  let released = false

  const release = () => {
    if (!released) {
      released = true
      reader.releaseLock()
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()

        if (result.done) {
          release()
          controller.close()
          return
        }

        size += result.value.byteLength

        if (size > maxSize) {
          const error = createSizeError(response, maxSize, config)

          await reader.cancel(error)
          release()
          controller.error(error)
          return
        }

        controller.enqueue(result.value)
      } catch (error) {
        release()
        controller.error(error)
      }
    },

    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        release()
      }
    }
  })
}

function createSizeError(
  response: Response,
  maxSize: number,
  config: RequestConfig
): RequestError {
  return new RequestError(
    `Response body exceeds maxResponseSize ${maxSize}`,
    {
      code: 'RESPONSE_TOO_LARGE',
      status: response.status,
      config
    }
  )
}

function streamingReadError(
  error: unknown,
  signal: AbortSignal | null | undefined,
  config: RequestConfig
): unknown {
  if (!signal?.aborted) {
    return error
  }

  if (signal.reason instanceof RequestError) {
    return new RequestError(signal.reason.message, {
      code: signal.reason.code,
      status: signal.reason.status,
      data: signal.reason.data,
      response: signal.reason.response,
      config,
      cause: signal.reason
    })
  }

  return new RequestError('Request aborted while consuming response', {
    code: 'ABORT_ERROR',
    config,
    cause: signal.reason ?? error
  })
}

function copyResponseMetadata(source: Response, target: Response): void {
  for (const key of ['url', 'redirected', 'type'] as const) {
    try {
      Object.defineProperty(target, key, {
        value: source[key],
        configurable: true
      })
    } catch {
      // Response metadata is best-effort across browser implementations.
    }
  }
}

function detectResponseType(response: Response): ResponseType {
  const contentType = response.headers.get('content-type') ?? ''
  const parameterStart = contentType.indexOf(';')
  const mediaType = contentType
    .slice(0, parameterStart === -1 ? undefined : parameterStart)
    .trim()
    .toLowerCase()

  if (mediaType === 'text/event-stream') {
    return 'sse'
  }

  if (
    mediaType === 'application/x-ndjson' ||
    mediaType === 'application/ndjson' ||
    hasStructuredSuffix(mediaType, '+ndjson')
  ) {
    return 'ndjson'
  }

  if (
    mediaType === 'application/json' ||
    hasStructuredSuffix(mediaType, '+json')
  ) {
    return 'json'
  }

  return 'text'
}

function hasStructuredSuffix(mediaType: string, suffix: string): boolean {
  const slashIndex = mediaType.indexOf('/')
  const suffixStart = mediaType.length - suffix.length

  return slashIndex > 0 && suffixStart > slashIndex + 1 &&
    mediaType.endsWith(suffix)
}
