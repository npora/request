import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  createClient,
  downloadPlugin,
  RequestError
} from '../src'

type XHRScenario = (xhr: FakeXMLHttpRequest) => void

let scenario: XHRScenario

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []

  method = ''
  url = ''
  async = true
  responseType: XMLHttpRequestResponseType = ''
  withCredentials = false
  status = 200
  statusText = 'OK'
  response: unknown = new Blob(['npora'])
  requestBody: XMLHttpRequestBodyInit | null = null
  aborted = false
  requestHeaders = new Headers()
  responseHeaders =
    'content-type: text/plain\r\nx-download: xhr\r\n'

  onload: ((event: ProgressEvent) => void) | null = null
  onerror: ((event: ProgressEvent) => void) | null = null
  onabort: ((event: ProgressEvent) => void) | null = null
  onprogress:
    | ((event: ProgressEvent<EventTarget>) => void)
    | null = null

  constructor() {
    FakeXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string, async = true): void {
    this.method = method
    this.url = url
    this.async = async
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.append(name, value)
  }

  getAllResponseHeaders(): string {
    return this.responseHeaders
  }

  send(body: XMLHttpRequestBodyInit | null = null): void {
    this.requestBody = body
    scenario(this)
  }

  abort(): void {
    this.aborted = true
    this.onabort?.({} as ProgressEvent)
  }

  progress(loaded: number, total?: number): void {
    this.onprogress?.(
      {
        loaded,
        total: total ?? 0,
        lengthComputable: total !== undefined
      } as ProgressEvent<EventTarget>
    )
  }

  load(): void {
    this.onload?.({} as ProgressEvent)
  }

  fail(): void {
    this.onerror?.({} as ProgressEvent)
  }
}

beforeEach(() => {
  FakeXMLHttpRequest.instances = []
  scenario = xhr => {
    xhr.progress(5, 5)
    xhr.load()
  }
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('downloadPlugin XMLHttpRequest fallback', () => {
  it('should use forced XHR without issuing a Fetch request', async () => {
    const fetchMock = vi.fn()
    const onProgress = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      baseURL: 'https://api.example.com',
      headers: {
        authorization: 'Bearer token'
      },
      fetchOptions: {
        credentials: 'include'
      }
    }).use(downloadPlugin({ transport: 'xhr' }))

    const data = await request.get<Blob>('/file', {
      query: {
        version: 1
      },
      extensions: {
        download: {
          onProgress
        }
      }
    })
    const xhr = FakeXMLHttpRequest.instances[0]

    expect(await data.text()).toBe('npora')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(xhr).toMatchObject({
      method: 'GET',
      url: 'https://api.example.com/file?version=1',
      async: true,
      responseType: 'blob',
      withCredentials: true
    })
    expect(xhr.requestHeaders.get('authorization')).toBe(
      'Bearer token'
    )
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 5,
      total: 5,
      progress: 1
    })
    expect(xhr.onload).toBeNull()
    expect(xhr.onprogress).toBeNull()
  })

  it('should automatically fall back when Fetch streams are unavailable', async () => {
    const fetchMock = vi.fn()
    const NativeReadableStream = globalThis.ReadableStream

    scenario = xhr => {
      xhr.progress(5, 5)

      // Node.js 22's native Response constructor reads the global
      // ReadableStream constructor internally. Restore it after the plugin
      // has selected XHR so the test isolates transport selection instead of
      // breaking the runtime's Response implementation.
      vi.stubGlobal('ReadableStream', NativeReadableStream)
      xhr.load()
    }

    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ReadableStream', undefined)

    const request = createClient().use(downloadPlugin())
    const data = await request.get<Blob>('/file', {
      download: {
        onProgress: vi.fn()
      }
    })

    expect(await data.text()).toBe('npora')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(FakeXMLHttpRequest.instances).toHaveLength(1)
  })

  it('should expose HTTP and network failures as RequestError', async () => {
    scenario = xhr => {
      xhr.status = 404
      xhr.statusText = 'Not Found'
      xhr.response = new Blob(['missing'])
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const config = {
      download: {
        onProgress: vi.fn()
      }
    }

    await expect(
      request.get('/missing', config)
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404
    })

    scenario = xhr => {
      xhr.fail()
    }

    await expect(
      request.get('/offline', config)
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })
  })

  it('should handle successful responses without an HTTP body', async () => {
    scenario = xhr => {
      xhr.status = 204
      xhr.statusText = 'No Content'
      xhr.response = new Blob()
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const response = await request.getResponse<void>('/empty', {
      download: {
        onProgress: vi.fn()
      }
    })

    expect(response.status).toBe(204)
    expect(response.data).toBeUndefined()
    expect(response.raw.body).toBeNull()
  })

  it('should abort XHR for external cancellation and timeout', async () => {
    scenario = () => {}

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const controller = new AbortController()
    const aborted = request.get('/abort', {
      signal: controller.signal,
      download: {
        onProgress: vi.fn()
      }
    })
    const abortedAssertion = expect(aborted).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })

    controller.abort()

    await abortedAssertion
    expect(FakeXMLHttpRequest.instances[0]?.aborted).toBe(true)

    vi.useFakeTimers()

    const timedOut = request.get('/timeout', {
      timeout: 25,
      download: {
        onProgress: vi.fn()
      }
    })
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })

    await vi.advanceTimersByTimeAsync(25)
    await timeoutAssertion
    expect(FakeXMLHttpRequest.instances[1]?.aborted).toBe(true)
  })

  it('should stop the transfer when a progress callback fails', async () => {
    const callbackError = new Error('progress failed')

    scenario = xhr => {
      xhr.progress(1, 2)
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(
      request.get('/file', {
        download: {
          onProgress() {
            throw callbackError
          }
        }
      })
    ).rejects.toBe(callbackError)
    expect(FakeXMLHttpRequest.instances[0]?.aborted).toBe(true)
  })

  it('should complete 100 concurrent downloads without shared state', async () => {
    scenario = xhr => {
      queueMicrotask(() => {
        const id = new URL(xhr.url).searchParams.get('id')

        xhr.response = new Blob([id ?? ''])
        xhr.progress(1, 1)
        xhr.load()
      })
    }

    const fetchMock = vi.fn()
    const progress = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      baseURL: 'https://api.example.com'
    }).use(downloadPlugin({ transport: 'xhr' }))
    const downloads = await Promise.all(
      Array.from({ length: 100 }, async (_, id) => {
        const blob = await request.get<Blob>('/stress', {
          query: {
            id
          },
          download: {
            onProgress: progress
          }
        })

        return blob.text()
      })
    )

    expect(downloads).toEqual(
      Array.from({ length: 100 }, (_, id) => String(id))
    )
    expect(FakeXMLHttpRequest.instances).toHaveLength(100)
    expect(progress).toHaveBeenCalledTimes(100)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject forced XHR when the runtime does not provide it', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined)

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(
      request.get('/file', {
        download: {
          onProgress: vi.fn()
        }
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<RequestError>>({
        code: 'CONFIG_ERROR'
      })
    )
  })
})
