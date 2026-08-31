import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  createClient,
  type Plugin,
  RequestError
} from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Fetch response cloning', () => {
  it('should parse a data-only response without cloning', async () => {
    const response = jsonResponse({
      ok: true
    })
    const clone = vi.spyOn(response, 'clone')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    )

    const request = createClient()
    const data = await request.get('/data')

    expect(data).toEqual({
      ok: true
    })
    expect(clone).not.toHaveBeenCalled()
    expect(response.bodyUsed).toBe(true)
  })

  it('should preserve raw body for complete responses', async () => {
    const response = jsonResponse({
      ok: true
    })
    const clone = vi.spyOn(response, 'clone')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    )

    const request = createClient()
    const complete = await request.getResponse('/data')

    expect(clone).toHaveBeenCalledTimes(1)
    expect(complete.raw.bodyUsed).toBe(false)
    await expect(complete.raw.json()).resolves.toEqual({
      ok: true
    })
  })

  it('should preserve raw body for response interceptors', async () => {
    const response = jsonResponse({
      ok: true
    })
    const clone = vi.spyOn(response, 'clone')
    let rawBodyUsed: boolean | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    )

    const request = createClient()

    request.interceptors.response.use(complete => {
      rawBodyUsed = complete.raw.bodyUsed

      return complete
    })

    await request.get('/data')

    expect(clone).toHaveBeenCalledTimes(1)
    expect(rawBodyUsed).toBe(false)
  })

  it('should preserve raw body for plugin response hooks', async () => {
    const response = jsonResponse({
      ok: true
    })
    const clone = vi.spyOn(response, 'clone')
    let rawBodyUsed: boolean | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    )

    const plugin: Plugin = {
      name: 'raw-observer',
      install({ hooks }) {
        hooks.onResponse(context => {
          rawBodyUsed = context.response?.raw.bodyUsed
        })
      }
    }
    const request = createClient().use(plugin)

    await request.get('/data')

    expect(clone).toHaveBeenCalledTimes(1)
    expect(rawBodyUsed).toBe(false)
  })

  it('should consume one response body for HTTP errors', async () => {
    const response = jsonResponse(
      {
        message: 'invalid'
      },
      422
    )
    const clone = vi.spyOn(response, 'clone')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    )

    const request = createClient()
    let captured: RequestError | undefined

    try {
      await request.get('/error')
    } catch (error) {
      captured = error as RequestError
    }

    expect(clone).not.toHaveBeenCalled()
    expect(captured?.code).toBe('HTTP_ERROR')
    expect(captured?.data).toEqual({ message: 'invalid' })
    expect(captured?.response?.raw).toBe(response)
    expect(captured?.response?.raw.bodyUsed).toBe(true)
    await expect(
      captured?.response?.raw.json()
    ).rejects.toThrow()
  })

  it('should not clone an automatically detected streaming response', async () => {
    const response = new Response('{"id":1}\n', {
      headers: {
        'content-type': 'application/x-ndjson'
      }
    })
    const clone = vi.spyOn(response, 'clone')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    )

    const complete = await createClient().ndjsonResponse<{ id: number }>(
      '/records'
    )
    const values = []

    for await (const value of complete.data) {
      values.push(value)
    }

    expect(values).toEqual([{ id: 1 }])
    expect(clone).not.toHaveBeenCalled()
    expect(complete.raw.bodyUsed).toBe(true)
  })
})

function jsonResponse(
  data: unknown,
  status = 200
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'content-type': 'application/json'
      }
    }
  )
}
