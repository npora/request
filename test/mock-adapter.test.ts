import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  MockAdapter,
  retryPlugin
} from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('MockAdapter', () => {
  it('should return mock response from constructor handlers', async () => {
    const adapter = new MockAdapter({
      handlers: {
        '/user': () => ({
          name: 'Npora'
        })
      }
    })

    const response = await adapter.request<{ name: string }>({
      url: '/user'
    })

    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      name: 'Npora'
    })
  })

  it('should return mock response from on method', async () => {
    const adapter = new MockAdapter()

    adapter.on('/todo', () => ({
      id: 1,
      title: 'Learn Npora'
    }))

    const response = await adapter.request<{ id: number; title: string }>({
      url: '/todo'
    })

    expect(response.data).toEqual({
      id: 1,
      title: 'Learn Npora'
    })
  })

  it('should throw when mock handler is missing', async () => {
    const adapter = new MockAdapter()

    await expect(
      adapter.request({
        url: '/missing'
      })
    ).rejects.toThrow('No mock handler found for /missing')
  })

  it('should match routes by HTTP method and return response metadata', async () => {
    const adapter = new MockAdapter()

    adapter
      .onGet('/resource')
      .reply(200, { method: 'get' })
      .onPost('/resource')
      .reply(201, { method: 'post' }, {
        headers: {
          'x-mock': 'created'
        },
        statusText: 'Created'
      })

    const getResponse = await adapter.request({
      url: '/resource',
      method: 'GET'
    })
    const postResponse = await adapter.request({
      url: '/resource',
      method: 'POST'
    })

    expect(getResponse.data).toEqual({
      method: 'get'
    })
    expect(postResponse).toMatchObject({
      status: 201,
      statusText: 'Created',
      data: {
        method: 'post'
      }
    })
    expect(postResponse.headers.get('x-mock')).toBe('created')
    expect(postResponse.raw.status).toBe(201)
  })

  it('should match regular expressions, query parameters and headers', async () => {
    const adapter = new MockAdapter()

    adapter.onGet({
      url: /^\/users\/\d+$/,
      query: {
        include: ['profile', 'roles'],
        active: true
      },
      headers: {
        authorization: 'Bearer test-token'
      }
    }).reply(200, {
      matched: true
    })

    await expect(
      adapter.request({
        url: '/users/42',
        method: 'GET',
        query: {
          active: true,
          include: ['profile', 'roles']
        },
        headers: {
          authorization: 'Bearer test-token',
          'x-extra': 'allowed'
        }
      })
    ).resolves.toMatchObject({
      data: {
        matched: true
      }
    })

    await expect(
      adapter.request({
        url: '/users/42',
        method: 'GET',
        query: {
          active: false,
          include: ['profile', 'roles']
        },
        headers: {
          authorization: 'Bearer test-token'
        }
      })
    ).rejects.toThrow('No mock handler found')
  })

  it('should create dynamic replies from the effective request config', async () => {
    const adapter = new MockAdapter()

    adapter.onPatch('/user').reply(config => ({
      status: 202,
      data: {
        body: config.json
      },
      headers: {
        'x-dynamic': 'true'
      }
    }))

    const response = await adapter.request({
      url: '/user',
      method: 'PATCH',
      json: {
        name: 'Npora'
      }
    })

    expect(response.status).toBe(202)
    expect(response.data).toEqual({
      body: {
        name: 'Npora'
      }
    })
    expect(response.headers.get('x-dynamic')).toBe('true')
  })

  it('should consume one-time rules before persistent fallbacks', async () => {
    const adapter = new MockAdapter()

    adapter
      .onGet('/sequence')
      .replyOnce(503, { attempt: 1 })
      .onGet('/sequence')
      .reply(200, { attempt: 2 })

    await expect(
      adapter.request({
        url: '/sequence',
        method: 'GET',
        validateStatus: () => true
      })
    ).resolves.toMatchObject({
      status: 503,
      data: {
        attempt: 1
      }
    })

    await expect(
      adapter.request({
        url: '/sequence',
        method: 'GET',
        validateStatus: () => true
      })
    ).resolves.toMatchObject({
      status: 200,
      data: {
        attempt: 2
      }
    })
  })

  it('should simulate network and timeout errors', async () => {
    const adapter = new MockAdapter()

    adapter
      .onGet('/offline')
      .networkError('offline')
      .onGet('/timeout')
      .timeout('too slow')

    await expect(
      adapter.request({
        url: '/offline',
        method: 'GET'
      })
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'offline'
    })

    await expect(
      adapter.request({
        url: '/timeout',
        method: 'GET'
      })
    ).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR',
      message: 'too slow'
    })
  })

  it('should expose HTTP errors to retry plugins', async () => {
    const adapter = new MockAdapter()

    adapter
      .onGet('/retry')
      .replyOnce(503, {
        message: 'busy'
      })
      .onGet('/retry')
      .reply(200, { ok: true })

    const request = createClient({
      adapter
    }).use(
      retryPlugin({
        retries: 1,
        delay: 0
      })
    )

    await expect(request.get('/retry')).resolves.toEqual({
      ok: true
    })
    expect(adapter.history).toHaveLength(2)
  })

  it('should support delayed responses and request timeouts', async () => {
    vi.useFakeTimers()

    const adapter = new MockAdapter()

    adapter.onGet('/slow').reply(200, { ok: true }, {
      delay: 100
    })

    const promise = adapter.request({
      url: '/slow',
      method: 'GET',
      timeout: 50
    })
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })

    await vi.advanceTimersByTimeAsync(50)
    await assertion
  })

  it('should abort a delayed mock without waiting for its timer', async () => {
    vi.useFakeTimers()

    const adapter = new MockAdapter({
      delay: 1000
    })
    const controller = new AbortController()

    adapter.onGet('/abort').reply(200, { ok: true })

    const promise = adapter.request({
      url: '/abort',
      method: 'GET',
      signal: controller.signal
    })

    controller.abort('cancelled')

    await expect(promise).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
  })

  it('should expose and reset request history and handlers', async () => {
    const adapter = new MockAdapter()

    adapter.onDelete('/items/1').reply(204)

    await adapter.request({
      url: '/items/1',
      method: 'DELETE'
    })

    expect(adapter.history).toEqual([
      expect.objectContaining({
        url: '/items/1',
        method: 'DELETE'
      })
    ])
    expect(adapter.resetHistory()).toBe(adapter)
    expect(adapter.history).toEqual([])

    adapter.resetHandlers()

    await expect(
      adapter.request({
        url: '/items/1',
        method: 'DELETE'
      })
    ).rejects.toThrow('No mock handler found')

    expect(adapter.reset()).toBe(adapter)
    expect(adapter.history).toEqual([])
  })
})
