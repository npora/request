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
      download: {
        filename: 'npora.txt',
        onProgress
      }
    })

    expect(data).toBeInstanceOf(Blob)
    expect(await data.text()).toBe('hello npora')

    expect(onProgress).toHaveBeenCalledTimes(2)

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loaded: firstChunk.byteLength,
      total,
      progress: firstChunk.byteLength / total
    })

    expect(onProgress).toHaveBeenNthCalledWith(2, {
      loaded: total,
      total,
      progress: 1
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
      download: {
        onProgress
      }
    })

    expect(await data.text()).toBe('npora')

    expect(onProgress).toHaveBeenCalledWith({
      loaded: chunk.byteLength,
      total: undefined
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
      download: {
        onProgress: vi.fn()
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
