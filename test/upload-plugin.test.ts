import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, uploadPlugin } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadPlugin', () => {
  it('should convert upload data to formData request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(uploadPlugin())

    const data = await request.request<{ ok: boolean }>({
      url: '/upload',
      upload: {
        data: {
          name: 'Npora',
          enabled: true
        }
      }
    })

    expect(data).toEqual({ ok: true })

    const [, init] = fetchMock.mock.calls[0]

    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('should keep custom method when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(uploadPlugin())

    await request.request({
      url: '/upload',
      method: 'PUT',
      upload: {
        data: {
          name: 'Npora'
        }
      }
    })

    const [, init] = fetchMock.mock.calls[0]

    expect(init.method).toBe('PUT')
    expect(init.body).toBeInstanceOf(FormData)
  })
})
