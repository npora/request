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
  type JsonParserContext,
  type Plugin,
  RequestError,
  retryPlugin
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
  it('should parse buffered XHR bytes as Uint8Array', async () => {
    scenario = xhr => {
      xhr.response = new Blob([new Uint8Array([1, 2, 3, 4])])
      xhr.responseHeaders = 'content-type: application/octet-stream\r\n'
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const data = await request.get<Uint8Array>('/bytes', {
      responseType: 'bytes',
      extensions: {
        download: { onProgress() {} }
      }
    })

    expect(data).toBeInstanceOf(Uint8Array)
    expect([...data]).toEqual([1, 2, 3, 4])
    expect(FakeXMLHttpRequest.instances[0]?.requestHeaders.get('accept'))
      .toBe('*/*')
  })

  it('should parse buffered XHR FormData responses', async () => {
    const boundary = 'npora-xhr-boundary'

    scenario = xhr => {
      xhr.response = new Blob([
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="name"\r\n\r\n' +
        `Npora\r\n--${boundary}--\r\n`
      ])
      xhr.responseHeaders =
        `content-type: multipart/form-data; boundary=${boundary}\r\n`
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const data = await request.get<FormData>('/form-data', {
      responseType: 'formData',
      extensions: {
        download: { onProgress() {} }
      }
    })

    expect([...data.entries()]).toEqual([['name', 'Npora']])
  })

  it('should custom-parse buffered JSON responses', async () => {
    scenario = xhr => {
      xhr.response = new Blob(['{"value":"npora"}'], {
        type: 'application/json'
      })
      xhr.responseHeaders =
        'content-type: application/json\r\nx-parser: xhr\r\n'
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    let parserContext: JsonParserContext | undefined

    await expect(request.get('/json', {
      responseType: 'json',
      parseJson: async (text, context) => {
        parserContext = context

        return {
          value: JSON.parse(text).value.toUpperCase()
        }
      },
      extensions: {
        download: { onProgress() {} }
      }
    })).resolves.toEqual({ value: 'NPORA' })
    expect(parserContext?.config.url).toBe('/json')
    expect(parserContext?.response.status).toBe(200)
    expect(parserContext?.response.headers.get('x-parser')).toBe('xhr')
  })

  it('should retry failed XHR downloads through the normal retry lifecycle', async () => {
    const attempts: number[] = []
    scenario = xhr => {
      if (FakeXMLHttpRequest.instances.length === 1) {
        xhr.fail()
        return
      }

      xhr.load()
    }

    const request = createClient()
      .use(downloadPlugin({ transport: 'xhr' }))
      .use(retryPlugin({ retries: 1, delay: () => 0 }))
      .use({
        name: 'attempt-observer',
        install(context) {
          context.hooks.onTransport(request => attempts.push(request.attempt))
        }
      })

    const data = await request.get<Blob>('/file', {
      extensions: {
        download: { onProgress() {} }
      }
    })

    expect(await data.text()).toBe('npora')
    expect(FakeXMLHttpRequest.instances).toHaveLength(2)
    expect(attempts).toEqual([0, 1])
  })

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
    expect(data.type).toBe('text/plain')
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
      progress: 1,
      bytes: 5
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
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })

    expect(await data.text()).toBe('npora')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(FakeXMLHttpRequest.instances).toHaveLength(1)
  })

  it('should abort XHR when the response size limit is exceeded', async () => {
    scenario = xhr => {
      xhr.progress(6, 10)
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(
      request.get('/large-file', {
        maxResponseSize: 5,
        extensions: {
          download: {
            onProgress: vi.fn()
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE'
    })
    expect(FakeXMLHttpRequest.instances[0]?.aborted).toBe(true)
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
      extensions: {
        download: {
          onProgress: vi.fn()
        }
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

  it('should omit oversized parsed XHR error data', async () => {
    scenario = xhr => {
      xhr.status = 500
      xhr.statusText = 'Server Error'
      xhr.response = new Blob(['oversized error'])
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(request.get('/large-error', {
      maxErrorResponseSize: 4,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500,
      data: undefined,
      response: {
        data: undefined
      }
    })
  })

  it('should preserve HTTP_ERROR when XHR error JSON parsing fails', async () => {
    scenario = xhr => {
      xhr.status = 422
      xhr.statusText = 'Unprocessable Content'
      xhr.response = new Blob(['invalid-json'])
      xhr.responseHeaders = 'content-type: application/json\r\n'
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(request.get('/invalid-error-json', {
      responseType: 'json',
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 422,
      data: undefined,
      response: {
        data: undefined
      }
    })
  })

  it('should bound asynchronous XHR error parsing by default', async () => {
    vi.useFakeTimers()
    scenario = xhr => {
      xhr.status = 503
      xhr.statusText = 'Busy'
      xhr.response = new Blob(['{"message":"busy"}'])
      xhr.responseHeaders = 'content-type: application/json\r\n'
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const pending = request.get('/stalled-parser', {
      responseType: 'json',
      parseJson: () => new Promise(() => {}),
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503,
      data: undefined
    })

    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('should return parsed XHR error responses when throwing is disabled', async () => {
    scenario = xhr => {
      xhr.status = 404
      xhr.statusText = 'Not Found'
      xhr.response = new Blob(['missing'])
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(request.getResponse<string>('/missing', {
      throwHttpErrors: false,
      responseType: 'text',
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })).resolves.toMatchObject({
      status: 404,
      data: 'missing'
    })
  })

  it('should handle successful responses without an HTTP body', async () => {
    const clone = vi.spyOn(Response.prototype, 'clone')

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
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })

    expect(response.status).toBe(204)
    expect(response.data).toBeUndefined()
    expect(response.raw.body).toBeNull()
    expect(clone).not.toHaveBeenCalled()
  })

  it('should not clone the raw XHR body for data-only requests', async () => {
    const clone = vi.spyOn(Response.prototype, 'clone')
    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    const data = await request.get<Blob>('/file', {
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })

    expect(await data.text()).toBe('npora')
    expect(clone).not.toHaveBeenCalled()
  })

  it('should retain the raw XHR body on HTTP errors', async () => {
    scenario = xhr => {
      xhr.status = 422
      xhr.statusText = 'Unprocessable Content'
      xhr.response = new Blob(['invalid'])
      xhr.load()
    }

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const error = await request.get('/invalid', {
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    }).catch(reason => reason)

    expect(error).toBeInstanceOf(RequestError)
    expect(await error.response.raw.text()).toBe('invalid')
  })

  it('should preserve raw XHR bodies for hooks that require them', async () => {
    const clone = vi.spyOn(Response.prototype, 'clone')
    let rawText = ''
    const rawPlugin: Plugin = {
      name: 'raw-response-reader',
      install({ hooks }) {
        hooks.onResponse(async context => {
          rawText = await context.response?.raw.text() ?? ''
        })
      }
    }
    const request = createClient()
      .use(downloadPlugin({ transport: 'xhr' }))
      .use(rawPlugin)
    const config = {
      responseType: 'text' as const,
      maxResponseSize: 10,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    }

    await request.get<Blob>('/file', config)

    expect(rawText).toBe('npora')
    expect(clone).toHaveBeenCalledTimes(1)

    request.unuse(rawPlugin.name)
    clone.mockClear()
    await request.get<Blob>('/file', config)

    expect(clone).not.toHaveBeenCalled()
  })

  it('should preserve complete raw XHR blobs without cloning them', async () => {
    const clone = vi.spyOn(Response.prototype, 'clone')
    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const response = await request.getResponse<Blob>('/file', {
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })

    expect(await response.data.text()).toBe('npora')
    expect(await response.raw.text()).toBe('npora')
    expect(clone).not.toHaveBeenCalled()
  })

  it('should abort before serializing or creating an XHR', async () => {
    const controller = new AbortController()
    const serialize = vi.fn(() => ({ value: 'unused' }))

    controller.abort('already cancelled')

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(request.post('/abort', {
      json: {
        toJSON: serialize
      },
      signal: controller.signal,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })

    expect(serialize).not.toHaveBeenCalled()
    expect(FakeXMLHttpRequest.instances).toHaveLength(0)
  })

  it('should abort XHR for external cancellation and timeout', async () => {
    scenario = () => {}

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )
    const controller = new AbortController()
    const aborted = request.get('/abort', {
      signal: controller.signal,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
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
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })

    await vi.advanceTimersByTimeAsync(25)
    await timeoutAssertion
    expect(FakeXMLHttpRequest.instances[1]?.aborted).toBe(true)
  })

  it('should not send after synchronous abort listener registration', async () => {
    const sendScenario = vi.fn()
    const reason = new Error('synchronous XHR abort')
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      reason,
      addEventListener(_type: string, listener: EventListener) {
        this.aborted = true
        listener(new Event('abort'))
      },
      removeEventListener
    } as unknown as AbortSignal

    scenario = sendScenario

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(request.get('/sync-abort', {
      signal,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })).rejects.toMatchObject({
      code: 'ABORT_ERROR',
      cause: reason
    })

    expect(sendScenario).not.toHaveBeenCalled()
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(FakeXMLHttpRequest.instances[0]?.aborted).toBe(true)
  })

  it('should complete when abort listener cleanup throws', async () => {
    const removeEventListener = vi.fn(() => {
      throw new Error('listener cleanup failed')
    })
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener
    } as unknown as AbortSignal
    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    const data = await request.get<Blob>('/cleanup-error', {
      signal,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })

    expect(await data.text()).toBe('npora')
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('should clean up when abort listener registration fails', async () => {
    const sendScenario = vi.fn()
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      addEventListener() {
        throw new Error('listener registration failed')
      },
      removeEventListener
    } as unknown as AbortSignal

    scenario = sendScenario

    const request = createClient().use(
      downloadPlugin({ transport: 'xhr' })
    )

    await expect(request.get('/listener-error', {
      signal,
      extensions: {
        download: {
          onProgress: vi.fn()
        }
      }
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      cause: expect.objectContaining({
        message: 'listener registration failed'
      })
    })

    expect(sendScenario).not.toHaveBeenCalled()
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(FakeXMLHttpRequest.instances[0]?.aborted).toBe(true)
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
        extensions: {
          download: {
            onProgress() {
              throw callbackError
            }
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
          extensions: {
            download: {
              onProgress: progress
            }
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
        extensions: {
          download: {
            onProgress: vi.fn()
          }
        }
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<RequestError>>({
        code: 'CONFIG_ERROR'
      })
    )
  })
})
