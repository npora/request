import {
  expect,
  test
} from '@playwright/test'

interface User {
  id: number
  name: string
}

interface BrowserRequestClient {
  extend(options?: BrowserClientOptions): BrowserRequestClient

  get<T>(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<T>

  post<T>(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<T>

  headResponse(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<{
    data: undefined
    status: number
  }>

  options<T>(
    url: string,
    config?: BrowserRequestConfig
  ): Promise<T>
}

interface BrowserClientOptions {
  baseURL?: string
  headers?: Record<string, string>
  query?: Record<string, string | number>
}

interface BrowserRequestConfig {
  headers?: Record<string, string>
  json?: Record<string, unknown>
  query?: Record<string, string | number>
  timeout?: number
}

interface BrowserWindow extends Window {
  nporaRequest?: BrowserRequestClient
  nporaReady?: boolean
  nporaError?: string
}

test(
  'should send a GET request in the browser',
  async ({ page }) => {
    await page.goto('/')

    await page.waitForFunction(() => {
      const browserWindow =
        window as BrowserWindow

      return (
        browserWindow.nporaReady === true ||
        typeof browserWindow.nporaError ===
        'string'
      )
    })

    const initializationError =
      await page.evaluate(() => {
        const browserWindow =
          window as BrowserWindow

        return browserWindow.nporaError
      })

    expect(
      initializationError
    ).toBeUndefined()

    const user =
      await page.evaluate(async () => {
        const browserWindow =
          window as BrowserWindow

        if (!browserWindow.nporaRequest) {
          throw new Error(
            'Npora request client is unavailable'
          )
        }

        return browserWindow.nporaRequest.get<User>(
          '/user'
        )
      })

    expect(user).toEqual({
      id: 1,
      name: 'Npora'
    })
  }
)

test(
  'should merge extended defaults and send JSON in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const browserWindow = window as BrowserWindow
      const request = browserWindow.nporaRequest

      if (!request) {
        throw new Error(
          'Npora request client is unavailable'
        )
      }

      const child = request.extend({
        headers: {
          'x-client': 'browser'
        },
        query: {
          source: 'extended'
        }
      })

      return child.post<{
        method: string
        query: Record<string, string>
        headers: Record<string, string>
        body: Record<string, unknown>
      }>('/echo', {
        headers: {
          'x-request': 'child'
        },
        json: {
          name: 'Npora'
        }
      })
    })

    expect(result).toMatchObject({
      method: 'POST',
      query: {
        source: 'extended'
      },
      headers: {
        'x-client': 'browser',
        'x-request': 'child',
        'content-type': 'application/json'
      },
      body: {
        name: 'Npora'
      }
    })
  }
)

test(
  'should expose unified HTTP and timeout errors in the browser',
  async ({ page }) => {
    await openFixture(page)

    const errors = await page.evaluate(async () => {
      const browserWindow = window as BrowserWindow
      const request = browserWindow.nporaRequest

      if (!request) {
        throw new Error(
          'Npora request client is unavailable'
        )
      }

      const capture = async (
        operation: () => Promise<unknown>
      ) => {
        try {
          await operation()

          return {
            code: 'NO_ERROR'
          }
        } catch (error) {
          const requestError = error as {
            code?: string
            status?: number
            data?: unknown
          }

          return {
            code: requestError.code,
            status: requestError.status,
            data: requestError.data
          }
        }
      }

      return {
        http: await capture(() => {
          return request.get('/error')
        }),
        timeout: await capture(() => {
          return request.get('/slow', {
            timeout: 10
          })
        })
      }
    })

    expect(errors.http).toEqual({
      code: 'HTTP_ERROR',
      status: 422,
      data: {
        message: 'Invalid browser request'
      }
    })
    expect(errors.timeout).toEqual({
      code: 'TIMEOUT_ERROR',
      status: undefined,
      data: undefined
    })
  }
)

test(
  'should send a request from a Web Worker',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const workerSource = `
        self.onmessage = async event => {
          try {
            const { createClient } = await import(
              event.data.moduleURL
            )
            const request = createClient({
              baseURL: event.data.baseURL
            })
            const data = await request.get('/user')

            self.postMessage({ data })
          } catch (error) {
            self.postMessage({
              error:
                error instanceof Error
                  ? error.message
                  : String(error)
            })
          }
        }
      `
      const workerURL = URL.createObjectURL(
        new Blob([workerSource], {
          type: 'text/javascript'
        })
      )

      try {
        return await new Promise<{
          data?: User
          error?: string
        }>((resolve, reject) => {
          const worker = new Worker(workerURL, {
            type: 'module'
          })

          worker.onmessage = event => {
            worker.terminate()
            resolve(event.data)
          }
          worker.onerror = event => {
            worker.terminate()
            reject(new Error(event.message))
          }
          worker.postMessage({
            moduleURL: `${location.origin}/dist/index.js`,
            baseURL: `${location.origin}/api`
          })
        })
      } finally {
        URL.revokeObjectURL(workerURL)
      }
    })

    expect(result).toEqual({
      data: {
        id: 1,
        name: 'Npora'
      }
    })
  }
)

test(
  'should execute the plugin pipeline in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        cachePlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(cachePlugin())
      const key = crypto.randomUUID()
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 1000
          }
        }
      }

      return {
        first: await request.get(`/count?key=${key}`, config),
        second: await request.get(`/count?key=${key}`, config)
      }
    })

    expect(result).toEqual({
      first: {
        count: 1
      },
      second: {
        count: 1
      }
    })
  }
)

test(
  'should send HEAD and OPTIONS requests in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const browserWindow = window as BrowserWindow
      const request = browserWindow.nporaRequest

      if (!request) {
        throw new Error(
          'Npora request client is unavailable'
        )
      }

      const head = await request.headResponse('/user')
      const options = await request.options('/user')

      return {
        head: {
          data: head.data,
          status: head.status
        },
        options
      }
    })

    expect(result).toEqual({
      head: {
        data: undefined,
        status: 200
      },
      options: undefined
    })
  }
)

async function openFixture(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.goto('/')

  await page.waitForFunction(() => {
    const browserWindow = window as BrowserWindow

    return (
      browserWindow.nporaReady === true ||
      typeof browserWindow.nporaError === 'string'
    )
  })

  const initializationError = await page.evaluate(() => {
    const browserWindow = window as BrowserWindow

    return browserWindow.nporaError
  })

  expect(initializationError).toBeUndefined()
}
