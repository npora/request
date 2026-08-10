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
  maxResponseSize?: number
  schema?: BrowserStandardSchema
  responseType?:
    | 'json'
    | 'text'
    | 'blob'
    | 'arrayBuffer'
    | 'stream'
    | 'sse'
    | 'ndjson'
}

interface BrowserStandardSchema {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) =>
      | { value: unknown }
      | { issues: ReadonlyArray<{ message: string }> }
  }
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
  'should validate and transform a response in the browser',
  async ({ page }) => {
    await openFixture(page)

    const user = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      return request.get<User>('/user', {
        schema: {
          '~standard': {
            version: 1,
            vendor: 'browser-test',
            validate(value) {
              const record = value as User

              return {
                value: {
                  id: record.id,
                  name: record.name.toUpperCase()
                }
              }
            }
          }
        }
      })
    })

    expect(user).toEqual({
      id: 1,
      name: 'NPORA'
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
      const firstConfig = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 1000
          }
        },
        query: {
          key,
          page: 1,
          cache: 'enabled'
        }
      }
      const secondConfig = {
        extensions: {
          cache: {
            enabled: true,
            ttl: 1000
          }
        },
        query: {
          page: 1,
          key,
          cache: 'enabled'
        }
      }

      return {
        first: await request.get('/count', firstConfig),
        second: await request.get('/count', secondConfig)
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
  'should not persist no-store responses in the browser cache plugin',
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
        },
        query: {
          key
        }
      }

      return {
        first: await request.get('/count', config),
        second: await request.get('/count', config)
      }
    })

    expect(result).toEqual({
      first: {
        count: 1
      },
      second: {
        count: 2
      }
    })
  }
)

test(
  'should enforce the browser response size limit',
  async ({ page }) => {
    await openFixture(page)

    const code = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      try {
        await request.get('/download', {
          maxResponseSize: 1024,
          responseType: 'arrayBuffer'
        })
      } catch (error) {
        return (error as { code?: string }).code
      }

      return undefined
    })

    expect(code).toBe('RESPONSE_TOO_LARGE')
  }
)

test(
  'should parse server-sent events in the browser',
  async ({ page }) => {
    await openFixture(page)

    const events = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      const stream = await request.get<AsyncIterable<{
        data: string
        event: string
        id: string
      }>>(
        '/events',
        {
          responseType: 'sse'
        }
      )
      const events = []

      for await (const event of stream) {
        events.push(event)
      }

      return events
    })

    expect(events).toEqual([
      {
        data: '{"step":1}',
        event: 'ready',
        id: ''
      },
      {
        data: '{"step":2}',
        event: 'done',
        id: ''
      }
    ])
  }
)

test(
  'should parse NDJSON records in the browser',
  async ({ page }) => {
    await openFixture(page)

    const records = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      const stream = await request.get<AsyncIterable<{
        id: number
        name: string
      }>>('/records')
      const records = []

      for await (const record of stream) {
        records.push(record)
      }

      return records
    })

    expect(records).toEqual([
      { id: 1, name: '你好' },
      { id: 2, name: 'browser' }
    ])
  }
)

test(
  'should surface an interrupted browser response stream',
  async ({ page }) => {
    await openFixture(page)

    const failed = await page.evaluate(async () => {
      const request = (window as BrowserWindow).nporaRequest

      if (!request) {
        throw new Error('Npora request client is unavailable')
      }

      try {
        const stream = await request.get<ReadableStream<Uint8Array>>(
          '/stream-error',
          {
            responseType: 'stream'
          }
        )
        const reader = stream.getReader()

        while (!(await reader.read()).done) {
          // Consume until the transport reports the interruption.
        }

        return false
      } catch {
        return true
      }
    })

    expect(failed).toBe(true)
  }
)

test(
  'should enforce concurrency limits in the browser',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        concurrencyPlugin,
        createClient
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(concurrencyPlugin({
        maxConcurrent: 1,
        maxQueue: 0
      }))
      const first = request.get('/slow')
      let code: string | undefined

      try {
        await request.get('/user')
      } catch (error) {
        code = (error as { code?: string }).code
      }

      await first

      return code
    })

    expect(result).toBe('CONCURRENCY_LIMIT')
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

test(
  'should handle concurrent XHR download progress without Fetch',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        createClient,
        downloadPlugin
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(
        downloadPlugin({
          transport: 'xhr'
        })
      )
      let fetchCalls = 0
      const originalFetch = window.fetch

      window.fetch = (...args) => {
        fetchCalls += 1

        return originalFetch(...args)
      }

      try {
        const downloads = await Promise.all(
          Array.from({ length: 32 }, async (_, id) => {
            const events: Array<{
              loaded: number
              total?: number
              progress?: number
            }> = []
            const blob = await request.get(
              '/download',
              {
                query: {
                  id
                },
                extensions: {
                  download: {
                    onProgress(progress: {
                      loaded: number
                      total?: number
                      progress?: number
                    }) {
                      events.push(progress)
                    }
                  }
                }
              }
            )
            const last = events.at(-1)

            return {
              size: (blob as Blob).size,
              eventCount: events.length,
              loaded: last?.loaded,
              total: last?.total,
              progress: last?.progress
            }
          })
        )

        return {
          downloads,
          fetchCalls
        }
      } finally {
        window.fetch = originalFetch
      }
    })

    expect(result.fetchCalls).toBe(0)
    expect(result.downloads).toHaveLength(32)

    for (const download of result.downloads) {
      expect(download).toEqual({
        size: 64 * 1024,
        eventCount: expect.any(Number),
        loaded: 64 * 1024,
        total: 64 * 1024,
        progress: 1
      })
      expect(download.eventCount).toBeGreaterThan(0)
    }
  }
)

test(
  'should handle concurrent native XHR upload progress',
  async ({ page }) => {
    await openFixture(page)

    const result = await page.evaluate(async () => {
      const moduleURL = `${location.origin}/dist/index.js`
      const {
        createClient,
        uploadPlugin
      } = await import(moduleURL)
      const request = createClient({
        baseURL: '/api'
      }).use(uploadPlugin())
      const originalFetch = window.fetch
      let fetchCalls = 0

      window.fetch = (...args) => {
        fetchCalls += 1

        return originalFetch(...args)
      }

      try {
        const uploads = await Promise.all(
          Array.from({ length: 32 }, async (_, id) => {
            const events: Array<{
              loaded: number
              total?: number
              progress?: number
            }> = []
            const data = await request.post('/upload', {
              query: {
                id
              },
              extensions: {
                upload: {
                  data: {
                    id,
                    file: new Blob([
                      new Uint8Array(64 * 1024)
                    ])
                  },
                  onProgress(progress: {
                    loaded: number
                    total?: number
                    progress?: number
                  }) {
                    events.push(progress)
                  }
                }
              }
            }) as {
              received: number
              contentType: string
            }
            const last = events.at(-1)

            return {
              received: data.received,
              contentType: data.contentType,
              eventCount: events.length,
              loaded: last?.loaded,
              total: last?.total,
              progress: last?.progress
            }
          })
        )

        return {
          uploads,
          fetchCalls
        }
      } finally {
        window.fetch = originalFetch
      }
    })

    expect(result.fetchCalls).toBe(0)
    expect(result.uploads).toHaveLength(32)

    for (const upload of result.uploads) {
      expect(upload.received).toBeGreaterThan(64 * 1024)
      expect(upload.contentType).toContain(
        'multipart/form-data; boundary='
      )
      expect(upload.eventCount).toBeGreaterThan(0)
      expect(upload.loaded).toBe(upload.total)
      expect(upload.progress).toBe(1)
    }
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
