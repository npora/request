import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import { FetchAdapter } from '../src'
import { xhrRequest } from '../src/plugins/xhrTransport'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request body size limits', () => {
  it('should reject before Fetch dispatch', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/upload',
      method: 'POST',
      json: {
        value: 'oversized'
      },
      maxRequestSize: 4
    })).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE',
      config: {
        maxRequestSize: 4
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject before XMLHttpRequest construction', async () => {
    const xhrConstructor = vi.fn()

    vi.stubGlobal('XMLHttpRequest', xhrConstructor)

    await expect(xhrRequest({
      url: 'https://api.example.com/upload',
      method: 'POST',
      body: new Uint8Array(5),
      maxRequestSize: 4
    })).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE'
    })
    expect(xhrConstructor).not.toHaveBeenCalled()
  })

  it('should enforce streaming sizes while Fetch consumes the body', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const reader = (init?.body as ReadableStream).getReader()

      try {
        while (!(await reader.read()).done) {
          // Consume the request exactly as a Fetch transport would.
        }
      } catch {
        // Some Fetch implementations discard the stream error and its cause.
        throw new TypeError('fetch failed')
      }

      return new Response('{}', {
        headers: { 'content-type': 'application/json' }
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    let pulls = 0
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(pulls++ === 0 ? 1 : 4))
      },
      cancel
    })

    await expect(new FetchAdapter().request({
      url: 'https://api.example.com/upload',
      method: 'POST',
      body,
      maxRequestSize: 4
    })).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE'
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'REQUEST_TOO_LARGE' })
    )
  })

  it('should allow a stream exactly at maxRequestSize', async () => {
    let received = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader()

      for (;;) {
        const result = await reader.read()

        if (result.done) {
          break
        }

        received += result.value.byteLength
      }

      return new Response('{}', {
        headers: { 'content-type': 'application/json' }
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2))
        controller.enqueue(new Uint8Array(3))
        controller.close()
      }
    })

    await new FetchAdapter().request({
      url: 'https://api.example.com/upload',
      method: 'POST',
      body,
      maxRequestSize: 5
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(received).toBe(5)
  })
})
