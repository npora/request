import { RequestError } from '../errors'
import type {
  DownloadOutput,
  DownloadProgress,
  NporaResponse
} from '../types'
import type { Plugin } from './Plugin'
import { isBodylessResponse } from '../utils/parseResponse'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { isXHRResponse, xhrRequest } from './xhrTransport'
import { createTransferProgressTracker } from './transferProgress'
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

        const uploadProgress = resolveExtensionConfig(config, 'upload')?.onProgress
        if (uploadProgress && (options.transport === 'fetch' || output === 'stream')) {
          throw new RequestError('Upload progress requires XHR and cannot use Fetch or stream downloads', {
            code: 'CONFIG_ERROR', config
          })
        }

        if (output === 'stream') {
          validateStreamOutput(options.transport, config)

          return {
            ...config,
            responseType: 'stream'
          }
        }

        const responseType =
          download.onProgress &&
          !shouldUseXHR(options.transport, Boolean(uploadProgress))
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
        const uploadProgress = resolveExtensionConfig(requestContext.config, 'upload')?.onProgress

        if (
          download?.output === 'stream' ||
          !onProgress ||
          !shouldUseXHR(options.transport, Boolean(uploadProgress))
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
            onUploadProgress: uploadProgress,
            preserveRaw: requestContext.preserveRaw
          }
        )
      }, { priority: -3000 })

      context.hooks.onResponse(async requestContext => {
        const response = requestContext.response

        if (!response || isXHRResponse(response)) {
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
        const streamOutput = download.output === 'stream'

        if (
          stream === undefined &&
          isBodylessResponse(response.config.method, response.status, response.raw.type)
        ) {
          if (!streamOutput) {
            onProgress?.({ loaded: 0, total: 0, bytes: 0 })
            return
          }
          stream = new ReadableStream({
            start(controller) { controller.close() }
          })
        }

        if (!streamOutput && !onProgress) return

        if (!isReadableStream(stream)) {
          throw new RequestError('Download response stream is unavailable', {
            code: 'PARSER_ERROR',
            status: response.status,
            config: response.config
          })
        }

        if (streamOutput) {
          requestContext.response = {
            ...response,
            data: onProgress
              ? monitorDownloadStream(
                stream,
                response,
                onProgress
              )
              : stream
          }

          return
        }

        if (!onProgress) {
          return
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

function shouldUseXHR(
  transport: DownloadTransport = 'auto',
  uploadProgress = false
): boolean {
  if (transport === 'xhr') {
    return true
  }

  if (transport === 'fetch') {
    return false
  }

  return (
    uploadProgress || (
      !supportsFetchResponseStream() &&
      typeof XMLHttpRequest !== 'undefined'
    )
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
  const total = resolveDownloadTotal(response.headers)
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
      // Source cleanup must not delay delivery of the original failure.
      void reader.cancel(error).catch(() => {})
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
  const total = resolveDownloadTotal(response.headers)
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
          // Source cleanup must not delay delivery of the original failure.
          void reader.cancel(error).catch(() => {})
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
 * Snapshot each chunk before the producer can reuse its backing buffer.
 */
function toDownloadBuffer(
  chunk: Uint8Array<ArrayBufferLike>
): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength)

  copy.set(chunk)

  return copy.buffer
}

function resolveDownloadTotal(headers: Headers): number | undefined {
  const encoding = headers.get('content-encoding')?.trim().toLowerCase()
  // Fetch exposes decoded chunks, while Content-Length describes encoded bytes.
  if (encoding && encoding !== 'identity') return undefined
  const value = headers.get('content-length')
  if (!value) {
    return undefined
  }

  const total = Number(value)

  if (!Number.isFinite(total) || total < 0) {
    return undefined
  }

  return total
}
