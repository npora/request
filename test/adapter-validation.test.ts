import {
  describe,
  expect,
  it
} from 'vitest'
import {
  createClient,
  type Adapter,
  type NporaResponse,
  RequestError,
  retryPlugin
} from '../src'

describe('adapter validation handoff', () => {
  it('should reject unsupported methods before calling a custom adapter', async () => {
    let requests = 0
    const adapter: Adapter = {
      async request<T>(config): Promise<NporaResponse<T>> {
        requests += 1
        return createResponse(config) as NporaResponse<T>
      }
    }
    const request = createClient({ adapter })

    await expect(request.request({
      url: '/unsafe',
      method: 'TRACE' as never
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request method is invalid'
    })

    expect(requests).toBe(0)
  })

  it('should pass final validated headers to the adapter', async () => {
    let receivedHeaders: Headers | undefined
    let regularRequests = 0
    const adapter: Adapter = {
      async request<T>(
        config
      ): Promise<NporaResponse<T>> {
        regularRequests += 1

        return createResponse(config) as NporaResponse<T>
      },
      async requestValidated<T>(
        config,
        validatedHeaders
      ): Promise<NporaResponse<T>> {
        receivedHeaders = validatedHeaders

        return createResponse(config) as NporaResponse<T>
      }
    }
    const request = createClient({
      adapter,
      headers: {
        'x-client': 'npora'
      }
    })

    await request.get('/user', {
      headers: {
        'x-request': 'one'
      }
    })

    expect(receivedHeaders).toBeInstanceOf(Headers)
    expect(receivedHeaders?.get('x-client')).toBe('npora')
    expect(receivedHeaders?.get('x-request')).toBe('one')
    expect(regularRequests).toBe(0)
  })

  it('should pass prevalidated headers only on the first retry attempt', async () => {
    const receivedHeaders: Array<Headers | undefined> = []
    let attempt = 0
    const adapter: Adapter = {
      async request<T>(
        config
      ): Promise<NporaResponse<T>> {
        receivedHeaders.push(undefined)
        attempt += 1

        return createResponse(config) as NporaResponse<T>
      },
      async requestValidated<T>(
        config,
        validatedHeaders
      ): Promise<NporaResponse<T>> {
        receivedHeaders.push(validatedHeaders)
        attempt += 1

        throw new RequestError('temporary failure', {
          code: 'NETWORK_ERROR',
          config
        })
      }
    }
    const request = createClient({
      adapter
    }).use(retryPlugin())

    await request.get('/retry', {
      headers: {
        'x-request': 'retry'
      },
      extensions: {
        retry: {
          retries: 1,
          delay: 0
        }
      }
    })

    expect(receivedHeaders[0]).toBeInstanceOf(Headers)
    expect(receivedHeaders[1]).toBeUndefined()
  })
})

function createResponse(
  config: Parameters<Adapter['request']>[0]
): NporaResponse<{ ok: true }> {
  return {
    data: {
      ok: true
    },
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config,
    raw: new Response(
      JSON.stringify({
        ok: true
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      }
    )
  }
}
