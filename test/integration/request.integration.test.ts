import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest'
import {
  createServer,
  type IncomingMessage,
  type Server
} from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  authPlugin,
  cachePlugin,
  createClient,
  retryPlugin
} from '../../src'

interface TestServer {
  server: Server
  baseURL: string
}

let testServer: TestServer

beforeAll(async () => {
  testServer = await startTestServer()
})

afterAll(async () => {
  await closeTestServer(testServer.server)
})

describe('request integration', () => {
  it('should send a GET request with query parameters', async () => {
    const request = createClient({
      baseURL: testServer.baseURL
    })

    const data = await request.get<{
      method: string
      query: Record<string, string>
    }>('/query', {
      query: {
        page: 1,
        keyword: 'npora'
      }
    })

    expect(data).toEqual({
      method: 'GET',
      query: {
        page: '1',
        keyword: 'npora'
      }
    })
  })

  it('should send and parse a JSON request', async () => {
    const request = createClient({
      baseURL: testServer.baseURL
    })

    const data = await request.post<{
      name: string
    }>('/json', {
      json: {
        name: 'Npora'
      }
    })

    expect(data).toEqual({
      name: 'Npora'
    })
  })

  it('should retry a failed request', async () => {
    const request = createClient({
      baseURL: testServer.baseURL
    }).use(
      retryPlugin({
        retries: 1,
        delay: 0
      })
    )

    const data = await request.get<{
      attempts: number
    }>('/retry')

    expect(data).toEqual({
      attempts: 2
    })
  })

  it('should cache a response', async () => {
    const request = createClient({
      baseURL: testServer.baseURL
    }).use(cachePlugin())

    const first = await request.get<{
      count: number
    }>('/cache', {
      cache: {
        enabled: true,
        ttl: 1000
      }
    })

    const second = await request.get<{
      count: number
    }>('/cache', {
      cache: {
        enabled: true,
        ttl: 1000
      }
    })

    expect(first).toEqual({
      count: 1
    })

    expect(second).toEqual({
      count: 1
    })
  })

  it('should refresh an expired access token', async () => {
    let token = 'expired-token'

    const request = createClient({
      baseURL: testServer.baseURL
    }).use(
      authPlugin({
        token: () => token,

        refreshToken: async () => {
          token = 'valid-token'

          return token
        }
      })
    )

    const data = await request.get<{
      authenticated: boolean
    }>('/auth')

    expect(data).toEqual({
      authenticated: true
    })
  })
})

async function startTestServer(): Promise<TestServer> {
  let retryAttempts = 0
  let cacheCount = 0

  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? '/',
      'http://localhost'
    )

    response.setHeader('content-type', 'application/json')

    if (url.pathname === '/query') {
      response.end(
        JSON.stringify({
          method: request.method,
          query: Object.fromEntries(url.searchParams)
        })
      )

      return
    }

    if (url.pathname === '/json') {
      const body = await readRequestBody(request)

      response.end(body)

      return
    }

    if (url.pathname === '/retry') {
      retryAttempts += 1

      if (retryAttempts === 1) {
        response.statusCode = 500
        response.statusMessage = 'Server Error'

        response.end(
          JSON.stringify({
            message: 'Temporary error'
          })
        )

        return
      }

      response.end(
        JSON.stringify({
          attempts: retryAttempts
        })
      )

      return
    }

    if (url.pathname === '/cache') {
      cacheCount += 1

      response.end(
        JSON.stringify({
          count: cacheCount
        })
      )

      return
    }

    if (url.pathname === '/auth') {
      if (
        request.headers.authorization !==
        'Bearer valid-token'
      ) {
        response.statusCode = 401
        response.statusMessage = 'Unauthorized'

        response.end(
          JSON.stringify({
            message: 'Unauthorized'
          })
        )

        return
      }

      response.end(
        JSON.stringify({
          authenticated: true
        })
      )

      return
    }

    response.statusCode = 404

    response.end(
      JSON.stringify({
        message: 'Not Found'
      })
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)

    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    await closeTestServer(server)

    throw new Error('Failed to resolve test server address')
  }

  return {
    server,
    baseURL: `http://127.0.0.1:${(address as AddressInfo).port}`
  }
}

async function readRequestBody(
  request: IncomingMessage
): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    )
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function closeTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)

        return
      }

      resolve()
    })
  })
}
