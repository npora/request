import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  authPlugin,
  createClient,
  retryPlugin,
  uploadPlugin
} from '../src'

type Scenario = (xhr: FakeUploadXHR) => void

let scenario: Scenario

class FakeUploadXHR {
  static instances: FakeUploadXHR[] = []

  method = ''
  url = ''
  responseType: XMLHttpRequestResponseType = ''
  withCredentials = false
  status = 200
  statusText = 'OK'
  response: unknown = new Blob([
    JSON.stringify({
      ok: true
    })
  ])
  responseHeaders =
    'content-type: application/json\r\n'
  requestHeaders = new Headers()
  requestBody: XMLHttpRequestBodyInit | null = null
  aborted = false
  upload = {
    onprogress: null as
      | ((event: ProgressEvent<EventTarget>) => void)
      | null
  }

  onload: ((event: ProgressEvent) => void) | null = null
  onerror: ((event: ProgressEvent) => void) | null = null
  onabort: ((event: ProgressEvent) => void) | null = null
  onprogress:
    | ((event: ProgressEvent<EventTarget>) => void)
    | null = null

  constructor() {
    FakeUploadXHR.instances.push(this)
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
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

  uploadProgress(loaded: number, total?: number): void {
    this.upload.onprogress?.({
      loaded,
      total: total ?? 0,
      lengthComputable: total !== undefined
    } as ProgressEvent<EventTarget>)
  }

  load(): void {
    this.onload?.({} as ProgressEvent)
  }

  fail(): void {
    this.onerror?.({} as ProgressEvent)
  }
}

beforeEach(() => {
  FakeUploadXHR.instances = []
  scenario = xhr => {
    xhr.uploadProgress(5, 10)
    xhr.uploadProgress(10, 10)
    xhr.load()
  }
  vi.stubGlobal('XMLHttpRequest', FakeUploadXHR)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('uploadPlugin progress', () => {
  it('should report byte deltas, transfer rate and estimated time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    scenario = xhr => {
      vi.setSystemTime(1000)
      xhr.uploadProgress(4, 10)
      vi.setSystemTime(2000)
      xhr.uploadProgress(10, 10)
      xhr.load()
    }

    const onProgress = vi.fn()
    const request = createClient().use(uploadPlugin())

    await request.post('/upload', {
      extensions: {
        upload: {
          data: { name: 'report' },
          onProgress
        }
      }
    })

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loaded: 4,
      total: 10,
      progress: 0.4,
      bytes: 4,
      rate: 4,
      estimated: 1.5
    })
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      loaded: 10,
      total: 10,
      progress: 1,
      bytes: 6,
      rate: 5,
      estimated: 0
    })
  })

  it('should retry failed XHR uploads through the normal retry lifecycle', async () => {
    scenario = xhr => {
      if (FakeUploadXHR.instances.length === 1) {
        xhr.fail()
        return
      }

      xhr.load()
    }

    const request = createClient()
      .use(uploadPlugin())
      .use(retryPlugin({
        retries: 1,
        methods: ['POST'],
        delay: () => 0
      }))

    await expect(request.post('/upload', {
      extensions: {
        upload: {
          data: { name: 'report' },
          onProgress() {}
        }
      }
    })).resolves.toEqual({ ok: true })

    expect(FakeUploadXHR.instances).toHaveLength(2)
  })

  it('should refresh authentication and retry an XHR upload after 401', async () => {
    let token = 'expired-token'
    const refreshToken = vi.fn(async () => {
      token = 'refreshed-token'
      return token
    })

    scenario = xhr => {
      if (xhr.requestHeaders.get('authorization') === 'Bearer expired-token') {
        xhr.status = 401
        xhr.statusText = 'Unauthorized'
      }

      xhr.load()
    }

    const request = createClient()
      .use(authPlugin({ token: () => token, refreshToken }))
      .use(uploadPlugin())

    await expect(request.post('/upload', {
      extensions: {
        upload: {
          data: { name: 'report' },
          onProgress() {}
        }
      }
    })).resolves.toEqual({ ok: true })

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(FakeUploadXHR.instances).toHaveLength(2)
    expect(FakeUploadXHR.instances[1]?.requestHeaders.get('authorization'))
      .toBe('Bearer refreshed-token')
  })

  it('should send FormData with native XHR and parse JSON response', async () => {
    const fetchMock = vi.fn()
    const onProgress = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      baseURL: 'https://api.example.com',
      headers: {
        'x-client': 'npora'
      }
    }).use(uploadPlugin())
    const data = await request.post<{ ok: boolean }>('/upload', {
      query: {
        folder: 'docs'
      },
      extensions: {
        upload: {
          data: {
            name: 'report',
            enabled: true
          },
          onProgress
        }
      }
    })
    const xhr = FakeUploadXHR.instances[0]

    expect(data).toEqual({
      ok: true
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(xhr).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/upload?folder=docs',
      responseType: 'blob'
    })
    expect(xhr.requestBody).toBeInstanceOf(FormData)
    expect(xhr.requestHeaders.get('x-client')).toBe('npora')
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loaded: 5,
      total: 10,
      progress: 0.5,
      bytes: 5
    })
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      loaded: 10,
      total: 10,
      progress: 1,
      bytes: 5
    })
    expect(xhr.upload.onprogress).toBeNull()
  })

  it('should preserve raw bodies for complete buffered XHR responses', async () => {
    const clone = vi.spyOn(Response.prototype, 'clone')
    const request = createClient().use(uploadPlugin())
    const response = await request.postResponse<{ ok: boolean }>('/upload', {
      extensions: {
        upload: {
          data: { name: 'report' },
          onProgress() {}
        }
      }
    })

    expect(response.data).toEqual({ ok: true })
    await expect(response.raw.json()).resolves.toEqual({ ok: true })
    expect(clone).not.toHaveBeenCalled()
  })

  it('should parse buffered XHR array buffers directly', async () => {
    const request = createClient().use(uploadPlugin())
    const data = await request.post<ArrayBuffer>('/upload', {
      responseType: 'arrayBuffer',
      extensions: {
        upload: {
          data: { name: 'report' },
          onProgress() {}
        }
      }
    })

    expect(new TextDecoder().decode(data)).toBe('{"ok":true}')
  })

  it('should retain parser error metadata for buffered XHR JSON', async () => {
    scenario = xhr => {
      xhr.response = new Blob(['invalid-json'])
      xhr.load()
    }

    const request = createClient().use(uploadPlugin())

    await expect(request.post('/upload', {
      extensions: {
        upload: {
          data: { name: 'report' },
          onProgress() {}
        }
      }
    })).rejects.toMatchObject({
      code: 'PARSER_ERROR',
      status: 200,
      message: 'Failed to parse response'
    })
  })

  it('should support namespaced upload progress configuration', async () => {
    const onProgress = vi.fn()
    const request = createClient().use(uploadPlugin())

    await request.request({
      url: '/upload',
      extensions: {
        upload: {
          data: {
            name: 'report'
          },
          onProgress
        }
      }
    })

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(FakeUploadXHR.instances[0]?.method).toBe('POST')
  })

  it('should abort the upload when progress handling fails', async () => {
    const callbackError = new Error('upload progress failed')
    const request = createClient().use(uploadPlugin())

    await expect(
      request.post('/upload', {
        extensions: {
          upload: {
            data: {
              name: 'report'
            },
            onProgress() {
              throw callbackError
            }
          }
        }
      })
    ).rejects.toBe(callbackError)
    expect(FakeUploadXHR.instances[0]?.aborted).toBe(true)
  })

  it('should abort an active upload through its signal', async () => {
    scenario = () => {}

    const controller = new AbortController()
    const request = createClient().use(uploadPlugin())
    const upload = request.post('/upload', {
      signal: controller.signal,
      extensions: {
        upload: {
          data: {
            name: 'report'
          },
          onProgress: vi.fn()
        }
      }
    })
    const assertion = expect(upload).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })

    controller.abort()

    await assertion
    expect(FakeUploadXHR.instances[0]?.aborted).toBe(true)
  })

  it('should isolate 100 concurrent upload progress operations', async () => {
    scenario = xhr => {
      queueMicrotask(() => {
        const id = new URL(xhr.url).searchParams.get('id')

        xhr.response = new Blob([
          JSON.stringify({
            id
          })
        ])
        xhr.uploadProgress(1, 1)
        xhr.load()
      })
    }

    const fetchMock = vi.fn()
    const onProgress = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient({
      baseURL: 'https://api.example.com'
    }).use(uploadPlugin())
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, id) => {
        return request.post<{ id: string }>('/stress', {
          query: {
            id
          },
          extensions: {
            upload: {
              data: {
                id
              },
              onProgress
            }
          }
        })
      })
    )

    expect(results).toEqual(
      Array.from({ length: 100 }, (_, id) => ({
        id: String(id)
      }))
    )
    expect(FakeUploadXHR.instances).toHaveLength(100)
    expect(onProgress).toHaveBeenCalledTimes(100)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject progress when XMLHttpRequest is unavailable', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined)

    const request = createClient().use(uploadPlugin())

    await expect(
      request.post('/upload', {
        extensions: {
          upload: {
            data: {
              name: 'report'
            },
            onProgress: vi.fn()
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })
  })
})
