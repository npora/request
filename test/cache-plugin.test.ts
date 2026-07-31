import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CacheStore, Plugin } from '../src'
import {
  cachePlugin,
  createClient,
  MemoryCacheStore,
  retryPlugin
} from '../src'

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cachePlugin', () => {
  it('should cache response when cache is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ name: 'Npora' }))

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
      extensions: {
        cache: {
          enabled: true,
          ttl: 100
        }
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
      extensions: {
        cache: {
          enabled: true,
          ttl: 100
        }
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
      extensions: {
        cache: {
          enabled: true,
          key: 'user'
        }
      }
    })

    await request.get('/user/2', {
      extensions: {
        cache: {
          enabled: true,
          key: 'user'
        }
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
      extensions: {
        cache
      },
      query: {
        page: 1,
        keyword: 'npora'
      }
    })
    await request.get('/search', {
      extensions: {
        cache
      },
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
      extensions: {
        cache
      },
      responseType: 'text'
    })
    const buffer = await request.get<ArrayBuffer>('/document', {
      extensions: {
        cache
      },
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
      extensions: {
        cache: {
          enabled: true
        }
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
        extensions: {
          cache
        },
        headers: {
          authorization: 'Bearer token-1'
        }
      })
    ).resolves.toEqual({
      user: 1
    })

    await expect(
      request.get('/profile', {
        extensions: {
          cache
        },
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
      extensions: {
        cache: {
          enabled: true
        }
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
      extensions: {
        cache: {
          enabled: true
        }
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
      extensions: {
        cache: {
          enabled: true
        }
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
      extensions: {
        cache: {
          enabled: true
        }
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
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await request.get('/version', config)
    plugin.clear()

    await expect(request.get('/version', config)).resolves.toEqual({
      version: 2
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should deduplicate concurrent equivalent requests', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }
    const first = request.get<{ value: number }>('/shared', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const second = request.get<{ value: number }>('/shared', config)

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(createJsonResponse({ value: 1 }))

    const [firstData, secondData] = await Promise.all([
      first,
      second
    ])

    firstData.value = 2

    expect(secondData).toEqual({
      value: 1
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should allow disabling request deduplication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true,
          dedupe: false
        }
      }
    }

    await Promise.all([
      request.get('/shared', config),
      request.get('/shared', config)
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should keep followers pending while the leader retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(cachePlugin())
      .use(
        retryPlugin({
          retries: 1,
          delay: 0
        })
      )
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    const [first, second] = await Promise.all([
      request.get('/retry-shared', config),
      request.get('/retry-shared', config)
    ])

    expect(first).toEqual({
      ok: true
    })
    expect(second).toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should release followers with the final shared error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error('network down')
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }
    const results = await Promise.allSettled([
      request.get('/failed-shared', config),
      request.get('/failed-shared', config)
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(2)

    for (const result of results) {
      expect(result.status).toBe('rejected')

      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({
          code: 'NETWORK_ERROR',
          message: 'Network request failed'
        })
      }
    }
  })

  it('should abort one follower without cancelling the leader', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(cachePlugin())
    const cache = {
      enabled: true
    }
    const leader = request.get('/abort-shared', {
      extensions: {
        cache
      }
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const controller = new AbortController()
    const follower = request.get('/abort-shared', {
      signal: controller.signal,
      extensions: {
        cache
      }
    })

    controller.abort('follower cancelled')

    await expect(follower).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })

    resolveFetch(createJsonResponse({ ok: true }))

    await expect(leader).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should share a custom cache store between plugin instances', async () => {
    const store = new MemoryCacheStore()
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        shared: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const firstClient = createClient().use(
      cachePlugin({
        store
      })
    )
    const secondClient = createClient().use(
      cachePlugin({
        store
      })
    )
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    await firstClient.get('/stored', config)

    await expect(
      secondClient.get('/stored', config)
    ).resolves.toEqual({
      shared: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should isolate network requests from cache store failures', async () => {
    const store: CacheStore = {
      get: vi.fn().mockRejectedValue(new Error('get failed')),
      set: vi.fn().mockRejectedValue(new Error('set failed')),
      delete: vi.fn().mockRejectedValue(new Error('delete failed')),
      clear: vi.fn()
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      cachePlugin({
        store
      })
    )

    await expect(
      request.get('/store-failure', {
        extensions: {
          cache: {
            enabled: true
          }
        }
      })
    ).resolves.toEqual({
      ok: true
    })
  })

  it('should delete malformed external cache entries and fetch normally', async () => {
    const remove = vi.fn()
    const store: CacheStore = {
      get() {
        return {
          data: {
            stale: true
          },
          expiresAt: Date.now() + 1000,
          status: 999,
          statusText: 'Invalid',
          headers: []
        }
      },
      set() {},
      delete: remove,
      clear() {}
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        fresh: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient().use(
      cachePlugin({
        store
      })
    )

    await expect(
      request.get('/malformed', {
        extensions: {
          cache: {
            enabled: true
          }
        }
      })
    ).resolves.toEqual({
      fresh: true
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should release followers when the cache plugin is removed', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise<Response>(() => {})
    })

    vi.stubGlobal('fetch', fetchMock)

    const store = new MemoryCacheStore()
    const read = vi.spyOn(store, 'get')
    const cache = cachePlugin({
      store
    })
    const request = createClient().use(cache)
    const config = {
      extensions: {
        cache: {
          enabled: true
        }
      }
    }

    void request.get('/removed-cache', config)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const follower = request.get('/removed-cache', config)

    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
    })
    await Promise.resolve()
    request.unuse('cache')

    await expect(follower).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      message: 'Cache plugin removed during shared request'
    })
  })

  it('should not create shared state after removal during an async read', async () => {
    let resolveRead!: () => void
    const store: CacheStore = {
      get() {
        return new Promise<undefined>(resolve => {
          resolveRead = () => resolve(undefined)
        })
      },
      set() {},
      delete() {},
      clear() {}
    }
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        ok: true
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const cache = cachePlugin({
      store
    })
    const request = createClient().use(cache)
    const pending = request.get('/remove-during-read', {
      extensions: {
        cache: {
          enabled: true
        }
      }
    })

    await vi.waitFor(() => {
      expect(resolveRead).toBeTypeOf('function')
    })

    request.unuse('cache')
    resolveRead()

    await expect(pending).resolves.toEqual({
      ok: true
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
