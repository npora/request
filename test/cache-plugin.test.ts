import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachePlugin, clearCache, createClient } from '../src'

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

afterEach(() => {
  clearCache()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cachePlugin', () => {
  it('should cache response when cache is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ name: 'Npora' }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    const config = {
      cache: {
        enabled: true,
        ttl: 1000
      }
    }

    const first = await request.get('/user', config)
    const second = await request.get('/user', config)

    expect(first).toEqual({ name: 'Npora' })
    expect(second).toEqual({ name: 'Npora' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should not cache response when cache is disabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ name: 'Npora' }))
      .mockResolvedValueOnce(createJsonResponse({ name: 'Npora' }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    await request.get('/user')
    await request.get('/user')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should expire cache after ttl', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ version: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ version: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    const config = {
      cache: {
        enabled: true,
        ttl: 100
      }
    }

    const first = await request.get('/user', config)

    vi.advanceTimersByTime(101)

    const second = await request.get('/user', config)

    expect(first).toEqual({ version: 1 })
    expect(second).toEqual({ version: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should use custom cache key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())

    await request.get('/user/1', {
      cache: {
        enabled: true,
        key: 'user'
      }
    })

    await request.get('/user/2', {
      cache: {
        enabled: true,
        key: 'user'
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
