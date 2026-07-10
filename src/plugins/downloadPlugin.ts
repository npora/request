import { RequestError } from '../errors'
import type {
  DownloadProgress,
  NporaResponse
} from '../types'
import type { Plugin } from './Plugin'

export function downloadPlugin(): Plugin {
  return {
    name: 'download',

    install(context) {
      context.interceptors.request.use(config => {
        if (!config.download) {
          return config
        }

        const responseType = config.download.onProgress
          ? 'stream'
          : config.responseType ?? 'blob'

        return {
          ...config,
          responseType
        }
      })

      context.interceptors.response.use(async response => {
        const download = response.config.download
        const onProgress = download?.onProgress

        if (!download || !onProgress) {
          return response
        }

        const stream = response.data

        if (!(stream instanceof ReadableStream)) {
          throw new RequestError(
            'Download response stream is unavailable',
            {
              code: 'PARSER_ERROR',
              status: response.status
            }
          )
        }

        const blob = await consumeDownloadStream(
          stream,
          response,
          onProgress
        )

        return {
          ...response,
          data: blob
        }
      })
    }
  }
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
      const buffer = copyToArrayBuffer(chunk)

      chunks.push(buffer)
      loaded += chunk.byteLength

      onProgress(createProgress(loaded, total))
    }
  } finally {
    reader.releaseLock()
  }

  return new Blob(chunks, {
    type: response.headers.get('content-type') ?? ''
  })
}

/**
 * Copies an ArrayBufferLike-backed Uint8Array into a regular ArrayBuffer.
 *
 * This prevents SharedArrayBuffer-backed views from being passed to Blob,
 * which only accepts ArrayBuffer-compatible BlobPart values.
 */
function copyToArrayBuffer(
  chunk: Uint8Array<ArrayBufferLike>
): ArrayBuffer {
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
