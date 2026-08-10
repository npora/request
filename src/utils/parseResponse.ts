import { RequestError } from '../errors'
import type { RequestConfig, ResponseType } from '../types'

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
 * Parse a Fetch response according to the request configuration.
 */
export async function parseResponse<T = unknown>(
  response: Response,
  config: RequestConfig
): Promise<T> {
  if (
    config.method === 'HEAD' ||
    response.status === 204 ||
    response.status === 205
  ) {
    return undefined as T
  }

  const responseType =
    config.responseType ?? detectResponseType(response)
  const maxSize = config.maxResponseSize

  try {
    if (maxSize !== undefined && Number.isFinite(maxSize)) {
      await rejectOversizedContentLength(response, maxSize, config)

      if (responseType === 'stream') {
        return limitResponseStream(response, maxSize, config) as T
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

async function rejectOversizedContentLength(
  response: Response,
  maxSize: number,
  config: RequestConfig
): Promise<void> {
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
  responseType: Exclude<ResponseType, 'stream'>,
  response: Response
): T {
  switch (responseType) {
    case 'json':
      return JSON.parse(new TextDecoder().decode(bytes)) as T

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
      return new TextDecoder().decode(bytes) as T
  }
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

  if (
    contentType.includes('application/json') ||
    contentType.includes('+json')
  ) {
    return 'json'
  }

  return 'text'
}
