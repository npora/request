import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authPlugin, createClient, downloadPlugin, retryPlugin, uploadPlugin } from '../src'

type Handler = (xhr: ReplayXHR) => void
let handle: Handler

class ReplayXHR {
  static instances: ReplayXHR[] = []
  status = 200
  statusText = 'OK'
  response = new Blob(['complete'])
  headers = new Headers()
  body: FormData | undefined
  aborted = false
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onprogress: ((event: ProgressEvent) => void) | null = null
  onload: (() => void) | null = null
  onabort: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { ReplayXHR.instances.push(this) }
  open() {}
  setRequestHeader(name: string, value: string) { this.headers.set(name, value) }
  getAllResponseHeaders() { return 'content-type: application/octet-stream\r\n' }
  send(body: FormData) { this.body = body; handle(this) }
  abort() { this.aborted = true; this.onabort?.() }
  complete(status = 200) {
    this.status = status
    this.upload.onprogress?.({ loaded: 12, total: 12, lengthComputable: true } as ProgressEvent)
    if (this.aborted) return
    this.onprogress?.({ loaded: this.response.size, total: this.response.size, lengthComputable: true } as ProgressEvent)
    if (!this.aborted) this.onload?.()
  }
}

beforeEach(() => {
  ReplayXHR.instances = []
  handle = xhr => xhr.complete()
  vi.stubGlobal('XMLHttpRequest', ReplayXHR)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function form() {
  const data = new FormData()
  data.append('file', new Blob([new Uint8Array([0, 255, 1, 128, 10])]), 'payload.bin')
  data.append('label', 'alpha')
  data.append('label', 'beta')
  return data
}

function assertClean(xhr: ReplayXHR) {
  expect(xhr.onload).toBeNull()
  expect(xhr.onerror).toBeNull()
  expect(xhr.onabort).toBeNull()
  expect(xhr.onprogress).toBeNull()
  expect(xhr.upload.onprogress).toBeNull()
}

it.each([false, true])('preserves multipart bytes across 401 → 503 → 200 and both progress directions (reverse=%s)', async reverse => {
  let token = 'expired'
  const refreshToken = vi.fn(async () => { token = 'fresh'; return token })
  handle = xhr => xhr.complete([401, 503, 200][ReplayXHR.instances.length - 1])
  const plugins = [authPlugin({ token: () => token, refreshToken }),
    retryPlugin({ retries: 2, methods: ['POST'], delay: 0 }), uploadPlugin(), downloadPlugin()]
  const fetch = vi.fn()
  const client = createClient({ fetch })
  for (const plugin of reverse ? plugins.reverse() : plugins) client.use(plugin)
  const upload = vi.fn(), download = vi.fn()
  const result = await client.post<Blob>('/transfer', { extensions: {
    upload: { data: form(), onProgress: upload }, download: { onProgress: download }
  } })
  expect(await result.text()).toBe('complete')
  expect(refreshToken).toHaveBeenCalledOnce()
  expect(ReplayXHR.instances.map(xhr => xhr.headers.get('authorization'))).toEqual([
    'Bearer expired', 'Bearer fresh', 'Bearer fresh'
  ])
  for (const xhr of ReplayXHR.instances) {
    const file = xhr.body!.get('file') as File
    expect(file.name).toBe('payload.bin')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1, 128, 10]))
    expect(xhr.body!.getAll('label')).toEqual(['alpha', 'beta'])
    assertClean(xhr)
  }
  expect(upload).toHaveBeenCalledTimes(3)
  expect(download).toHaveBeenCalledTimes(3)
  expect(upload.mock.calls.map(([p]) => p.bytes)).toEqual([12, 12, 12])
  expect(download.mock.calls.map(([p]) => p.bytes)).toEqual([8, 8, 8])
  expect(fetch).not.toHaveBeenCalled()
})

it('cancels a delayed retry without sending another multipart body or retaining timers', async () => {
  vi.useFakeTimers()
  handle = xhr => xhr.complete(503)
  const retry = vi.fn()
  const controller = new AbortController()
  const client = createClient().use(uploadPlugin()).use(downloadPlugin())
    .use(retryPlugin({ retries: 2, methods: ['POST'], delay: 10000, onRetry: retry }))
  const pending = client.post('/transfer', { signal: controller.signal, timeout: 5000,
    extensions: { upload: { data: form(), onProgress() {} }, download: { onProgress() {} } }
  }).catch(error => error)
  await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce())
  expect(vi.getTimerCount()).toBe(1)
  controller.abort('stop retry')
  expect(await pending).toMatchObject({ code: 'ABORT_ERROR' })
  await vi.runAllTimersAsync()
  expect(ReplayXHR.instances).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
  assertClean(ReplayXHR.instances[0]!)
})

it('does not replay an upload after cancellation while token refresh is pending', async () => {
  let finish!: (token: string) => void
  const refreshToken = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  handle = xhr => xhr.complete(401)
  const controller = new AbortController()
  const client = createClient().use(authPlugin({ token: 'expired', refreshToken }))
    .use(uploadPlugin()).use(downloadPlugin()).use(retryPlugin({ retries: 2, methods: ['POST'], delay: 0 }))
  const pending = client.post('/transfer', { signal: controller.signal, extensions: {
    upload: { data: form(), onProgress() {} }, download: { onProgress() {} }
  } }).catch(error => error)
  await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledOnce())
  controller.abort('stop refresh replay')
  expect(await pending).toMatchObject({ code: 'ABORT_ERROR' })
  finish('fresh')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(ReplayXHR.instances).toHaveLength(1)
  assertClean(ReplayXHR.instances[0]!)
})

it.each(['upload', 'download'] as const)('preserves a %s callback failure without retrying or refreshing', async direction => {
  const failure = new Error('progress renderer failed')
  const refreshToken = vi.fn(async () => 'fresh')
  const client = createClient().use(authPlugin({ token: 'fresh', refreshToken }))
    .use(uploadPlugin()).use(downloadPlugin()).use(retryPlugin({ retries: 2, methods: ['POST'], delay: 0 }))
  await expect(client.post('/transfer', { extensions: {
    upload: { data: form(), onProgress() { if (direction === 'upload') throw failure } },
    download: { onProgress() { if (direction === 'download') throw failure } }
  } })).rejects.toBe(failure)
  expect(refreshToken).not.toHaveBeenCalled()
  expect(ReplayXHR.instances).toHaveLength(1)
  expect(ReplayXHR.instances[0]!.aborted).toBe(true)
  assertClean(ReplayXHR.instances[0]!)
})

it('cleans an active timed-out transfer when timeout retries are disabled', async () => {
  vi.useFakeTimers()
  handle = () => {}
  const client = createClient().use(uploadPlugin()).use(downloadPlugin())
    .use(retryPlugin({ retries: 2, methods: ['POST'], retryOnTimeout: false }))
  const pending = client.post('/transfer', { timeout: 25, extensions: {
    upload: { data: form(), onProgress() {} }, download: { onProgress() {} }
  } }).catch(error => error)
  await vi.advanceTimersByTimeAsync(25)
  expect(await pending).toMatchObject({ code: 'TIMEOUT_ERROR' })
  expect(ReplayXHR.instances).toHaveLength(1)
  expect(ReplayXHR.instances[0]!.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  assertClean(ReplayXHR.instances[0]!)
})
