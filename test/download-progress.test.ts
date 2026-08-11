import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, downloadPlugin } from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('downloadPlugin progress', () => {
  it('should report download progress and return a Blob', async () => {
    const firstChunk = new TextEncoder().encode('hello ')
    const secondChunk = new TextEncoder().encode('npora')

    const total =
      firstChunk.byteLength + secondChunk.byteLength

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstChunk)
        controller.enqueue(secondChunk)
        controller.close()
      }
    })

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': String(total)
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const onProgress = vi.fn()

    const request = createClient().use(downloadPlugin())

    const data = await request.get<Blob>('/download', {
      extensions: {
        download: {
          filename: 'npora.txt',
          onProgress
        }
      }
    })

    expect(data).toBeInstanceOf(Blob)
    expect(await data.text()).toBe('hello npora')

    expect(onProgress).toHaveBeenCalledTimes(2)

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loaded: firstChunk.byteLength,
      total,
      progress: firstChunk.byteLength / total,
      bytes: firstChunk.byteLength
    })

    expect(onProgress).toHaveBeenNthCalledWith(2, {
      loaded: total,
      total,
      progress: 1,
      bytes: secondChunk.byteLength
    })
  })

  it('should report loaded bytes without Content-Length', async () => {
    const chunk = new TextEncoder().encode('npora')

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.close()
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
    )

    const onProgress = vi.fn()

    const request = createClient().use(downloadPlugin())

    const data = await request.get<Blob>('/download', {
      extensions: {
        download: {
          onProgress
        }
      }
    })

    expect(await data.text()).toBe('npora')

    expect(onProgress).toHaveBeenCalledWith({
      loaded: chunk.byteLength,
      total: undefined,
      bytes: chunk.byteLength
    })
  })

  it('should report an empty streamed download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(), {
          status: 200,
          headers: {
            'content-length': '0',
            'content-type': 'application/octet-stream'
          }
        })
      )
    )

    const onProgress = vi.fn()
    const request = createClient().use(downloadPlugin())
    const data = await request.get<Blob>('/empty', {
      extensions: {
        download: { onProgress }
      }
    })

    expect(data.size).toBe(0)
    expect(onProgress).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 0,
      total: 0,
      bytes: 0
    })
  })

  it('should force stream parsing only when progress is enabled', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('download')
        )
        controller.close()
      }
    })

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/plain'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(downloadPlugin())

    await request.get<Blob>('/download', {
      responseType: 'text',
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should cancel the Fetch stream when progress handling fails', async () => {
    const callbackError = new Error('progress failed')
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('download')
        )
      },
      cancel
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200
        })
      )
    )

    const request = createClient().use(downloadPlugin())

    await expect(
      request.get('/download', {
        extensions: {
          download: {
            onProgress() {
              throw callbackError
            }
          }
        }
      })
    ).rejects.toBe(callbackError)
    expect(cancel).toHaveBeenCalledWith(callbackError)
  })
})
