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

  it('should leave indeterminate streaming sizes to the transport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8))
        controller.close()
      }
    })

    await new FetchAdapter().request({
      url: 'https://api.example.com/upload',
      method: 'POST',
      body,
      maxRequestSize: 1
    })

    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
