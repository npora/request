import { RequestError } from '../errors'
import type {
  DownloadOutput,
  DownloadProgress,
  NporaResponse
} from '../types'
import type { Plugin } from './Plugin'
import { isBodylessResponse } from '../utils/parseResponse'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { xhrRequest } from './xhrTransport'
import { createTransferProgressTracker } from './transferProgress'
import { isArrayBuffer } from '../utils/isBinaryBody'
import { isReadableStream } from '../utils/isReadableStream'

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
          'download'
        )

        if (!download) {
          return config
        }

        const output = resolveDownloadOutput(
          download.output,
          config
        )

        if (output === 'stream') {
          validateStreamOutput(options.transport, config)

          return {
            ...config,
            responseType: 'stream'
          }
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

      context.hooks.onTransport(async requestContext => {
        if (requestContext.response) {
          return
        }

        const download = resolveExtensionConfig(
          requestContext.config,
          'download'
        )
        const onProgress = download?.onProgress

        if (
          download?.output === 'stream' ||
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

        requestContext.response = await xhrRequest<Blob>(
          requestContext.config,
          {
            onDownloadProgress: onProgress,
            preserveRaw: requestContext.preserveRaw
          }
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
          'download'
        )
        const onProgress = download?.onProgress

        if (!download) {
          return
        }

        let stream = response.data

        if (download.output === 'stream') {
          if (
            stream === undefined &&
            isBodylessResponse(
              response.config.method,
              response.status,
              response.raw.type
            )
          ) {
            stream = createEmptyDownloadStream()
          }

          if (!isReadableStream(stream)) {
            throw unavailableDownloadStream(response)
          }

          if (onProgress) {
            requestContext.response = {
              ...response,
              data: monitorDownloadStream(
                stream,
                response,
                onProgress
              )
            }
          }

          return
        }

        if (!onProgress) {
          return
        }

        if (!isReadableStream(stream)) {
          throw unavailableDownloadStream(response)
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
      }, { requiresRawResponse: false })
    }
  }
}

function createEmptyDownloadStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    }
  })
}

function resolveDownloadOutput(
  output: unknown,
  config: NporaResponse['config']
): DownloadOutput {
  if (output === undefined || output === 'blob') {
    return 'blob'
  }

  if (output === 'stream') {
    return output
  }

  throw new RequestError(
    'Download output must be "blob" or "stream"',
    {
      code: 'CONFIG_ERROR',
      config
    }
  )
}

function validateStreamOutput(
  transport: DownloadTransport | undefined,
  config: NporaResponse['config']
): void {
  if (transport === 'xhr') {
    throw new RequestError(
      'Stream downloads require the Fetch transport',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  if (!supportsFetchResponseStream()) {
    throw new RequestError(
      'Fetch response streams are unavailable',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }
}

function unavailableDownloadStream(
  response: NporaResponse
): RequestError {
  return new RequestError(
    'Download response stream is unavailable',
    {
      code: 'PARSER_ERROR',
      status: response.status,
      config: response.config
    }
  )
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
  const trackProgress = createTransferProgressTracker()
  let loaded = 0
  let reported = false

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) {
        break
      }

      const chunk = result.value

      chunks.push(toDownloadBuffer(chunk))
      loaded += chunk.byteLength
      reported = true
      onProgress(trackProgress(loaded, total))
    }

    if (!reported) {
      onProgress(trackProgress(0, total))
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

function monitorDownloadStream(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  response: NporaResponse,
  onProgress: (progress: DownloadProgress) => void
): ReadableStream<Uint8Array<ArrayBufferLike>> {
  const reader = stream.getReader()
  const total = parseContentLength(
    response.headers.get('content-length')
  )
  const trackProgress = createTransferProgressTracker()
  let loaded = 0
  let reported = false
  let released = false

  const release = () => {
    if (!released) {
      released = true
      reader.releaseLock()
    }
  }

  return new ReadableStream<Uint8Array<ArrayBufferLike>>({
    async pull(controller) {
      try {
        const result = await reader.read()

        if (result.done) {
          if (!reported) {
            onProgress(trackProgress(0, total))
          }

          release()
          controller.close()
          return
        }

        loaded += result.value.byteLength
        reported = true
        onProgress(trackProgress(loaded, total))
        controller.enqueue(result.value)
      } catch (error) {
        try {
          await reader.cancel(error)
        } catch {
          // Preserve the original stream/progress failure.
        }

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
  }, {
    highWaterMark: 0
  })
}

/**
 * Reuses complete ArrayBuffer chunks and copies only sliced or
 * SharedArrayBuffer-backed views before passing them to Blob.
 */
function toDownloadBuffer(
  chunk: Uint8Array<ArrayBufferLike>
): ArrayBuffer {
  if (isArrayBuffer(chunk.buffer)) {
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
