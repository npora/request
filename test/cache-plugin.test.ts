import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from '../src'
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

  it('should read cache options from extensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        name: 'Npora'
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          ttl: 1000
        }
      }
    }

    await request.get('/user', config)
    await request.get('/user', config)

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

  it('should not extend ttl when a cached response is read', async () => {
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

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(90)

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 1
    })

    vi.advanceTimersByTime(11)

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
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

  it('should normalize query key order in the default cache key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }

    await request.get('/search', {
      cache,
      query: {
        page: 1,
        keyword: 'npora'
      }
    })
    await request.get('/search', {
      cache,
      query: {
        keyword: 'npora',
        page: 1
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should isolate cached data by response type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Npora', {
          status: 200,
          headers: {
            'content-type': 'text/plain'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode('Npora'), {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }
    const text = await request.get<string>('/document', {
      cache,
      responseType: 'text'
    })
    const buffer = await request.get<ArrayBuffer>('/document', {
      cache,
      responseType: 'arrayBuffer'
    })

    expect(text).toBe('Npora')
    expect(new TextDecoder().decode(buffer)).toBe('Npora')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should isolate cache stores between plugin instances', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ client: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ client: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const firstClient = createClient().use(cachePlugin())
    const secondClient = createClient().use(cachePlugin())
    const config = {
      cache: {
        enabled: true
      }
    }

    await expect(firstClient.get('/user', config)).resolves.toEqual({
      client: 1
    })
    await expect(secondClient.get('/user', config)).resolves.toEqual({
      client: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should vary the default cache key by authorization header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ user: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ user: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }

    await expect(
      request.get('/profile', {
        cache,
        headers: {
          authorization: 'Bearer token-1'
        }
      })
    ).resolves.toEqual({
      user: 1
    })

    await expect(
      request.get('/profile', {
        cache,
        headers: {
          authorization: 'Bearer token-2'
        }
      })
    ).resolves.toEqual({
      user: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not cache non-idempotent methods by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ order: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ order: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      cache: {
        enabled: true
      },
      json: {
        item: 'book'
      }
    }

    await expect(request.post('/orders', config)).resolves.toEqual({
      order: 1
    })
    await expect(request.post('/orders', config)).resolves.toEqual({
      order: 2
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should return independent copies of cached data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        profile: {
          name: 'Npora'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      cache: {
        enabled: true
      }
    }

    const first = await request.get<{
      profile: {
        name: string
      }
    }>('/profile', config)

    first.profile.name = 'Changed'

    const second = await request.get<{
      profile: {
        name: string
      }
    }>('/profile', config)

    expect(second.profile.name).toBe('Npora')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should run response interceptors once for every cache result', async () => {
    const responseInterceptor = vi.fn(response => {
      const data = response.data as {
        value: number
      }

      return {
        ...response,
        data: {
          value: data.value + 1
        }
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        value: 0
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      cache: {
        enabled: true
      }
    }

    request.interceptors.response.use(responseInterceptor)

    await expect(request.get('/value', config)).resolves.toEqual({
      value: 1
    })
    await expect(request.get('/value', config)).resolves.toEqual({
      value: 1
    })
    expect(responseInterceptor).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should run other response hooks for cache hits', async () => {
    const responseHook = vi.fn()
    const observer: Plugin = {
      name: 'cache-observer',
      install({ hooks }) {
        hooks.onResponse(responseHook)
      }
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(cachePlugin())
      .use(observer)
    const config = {
      cache: {
        enabled: true
      }
    }

    await request.get('/observed', config)
    await request.get('/observed', config)

    expect(responseHook).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should clear one plugin cache instance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ version: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ version: 2 }))

    vi.stubGlobal('fetch', fetchMock)

    const plugin = cachePlugin()
    const request = createClient().use(plugin)
    const config = {
      cache: {
        enabled: true
      }
    }

    await request.get('/version', config)
    plugin.clear()

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
