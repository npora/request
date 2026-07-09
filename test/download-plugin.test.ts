import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, downloadPlugin } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downloadPlugin', () => {
  it('should set responseType to blob when download is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['hello npora']), {
        status: 200
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(downloadPlugin())

    const data = await request.get<Blob>('/download', {
      download: {
        filename: 'npora.txt'
      }
    })

    expect(data).toBeInstanceOf(Blob)

    const [, init] = fetchMock.mock.calls[0]

    expect(init.method).toBe('GET')
  })

  it('should keep custom responseType when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('hello npora', {
        status: 200,
        headers: {
          'content-type': 'text/plain'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(downloadPlugin())

    const data = await request.get<string>('/download', {
      responseType: 'text',
      download: {
        filename: 'npora.txt'
      }
    })

    expect(data).toBe('hello npora')
  })
})
