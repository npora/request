import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  downloadPlugin,
  RequestError
} from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('downloadPlugin progress', () => {
  it('should return a progress stream without buffering the response', async () => {
    const firstChunk = new TextEncoder().encode('hello ')
    const secondChunk = new TextEncoder().encode('npora')
    const cancel = vi.fn()
    let pull = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = pull++ === 0 ? firstChunk : secondChunk

        controller.enqueue(chunk)
      },
      cancel
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(source, {
          status: 200,
          headers: {
            'content-length': String(
              firstChunk.byteLength + secondChunk.byteLength
            )
          }
        })
      )
    )

    const onProgress = vi.fn()
    const request = createClient().use(downloadPlugin())
    const stream = await request.get<ReadableStream<Uint8Array>>(
      '/stream',
      {
        extensions: {
          download: {
            output: 'stream',
            onProgress
          }
        }
      }
    )

    expect(stream).toBeInstanceOf(ReadableStream)
    expect(onProgress).not.toHaveBeenCalled()

    const reader = stream.getReader()
    const result = await reader.read()

    expect(result.value).toEqual(firstChunk)
    expect(onProgress).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenCalledWith({
      loaded: firstChunk.byteLength,
      total: firstChunk.byteLength + secondChunk.byteLength,
      progress: firstChunk.byteLength /
        (firstChunk.byteLength + secondChunk.byteLength),
      bytes: firstChunk.byteLength
    })

    await reader.cancel('consumer stopped')

    expect(cancel).toHaveBeenCalledWith('consumer stopped')
  })

  it('should reject XHR and invalid stream output before network I/O', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const xhrRequest = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(xhrRequest.get('/stream', {
      extensions: {
        download: { output: 'stream' }
      }
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })

    const invalidRequest = createClient().use(downloadPlugin())

    await expect(invalidRequest.get('/stream', {
      extensions: {
        download: {
          output: 'invalid' as 'stream'
        }
      }
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })

    vi.stubGlobal('ReadableStream', undefined)

    await expect(invalidRequest.get('/stream', {
      extensions: {
        download: { output: 'stream' }
      }
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should enforce response limits while a download stream is consumed', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
        controller.close()
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(source))
    )

    const request = createClient().use(downloadPlugin())
    const stream = await request.get<ReadableStream<Uint8Array>>(
      '/large-stream',
      {
        maxResponseSize: 5,
        extensions: {
          download: { output: 'stream' }
        }
      }
    )

    const reader = stream.getReader()

    await expect(reader.read()).rejects.toBeInstanceOf(RequestError)
    await expect(reader.closed).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE'
    })
  })

  it('should cancel a download stream when progress handling fails', async () => {
    const callbackError = new Error('stream progress failed')
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(source))
    )

    const request = createClient().use(downloadPlugin())
    const stream = await request.get<ReadableStream<Uint8Array>>(
      '/progress-error',
      {
        extensions: {
          download: {
            output: 'stream',
            onProgress() {
              throw callbackError
            }
          }
        }
      }
    )

    await expect(stream.getReader().read()).rejects.toBe(callbackError)
    expect(cancel).toHaveBeenCalledWith(callbackError)
  })

  it('should return an empty stream for a bodyless response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 204 })
      )
    )

    const onProgress = vi.fn()
    const request = createClient().use(downloadPlugin())
    const stream = await request.get<ReadableStream<Uint8Array>>(
      '/empty-stream',
      {
        extensions: {
          download: {
            output: 'stream',
            onProgress
          }
        }
      }
    )
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined
    })
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 0,
      total: undefined,
      bytes: 0
    })
  })

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
