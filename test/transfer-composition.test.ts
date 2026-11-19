import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { createClient, downloadPlugin, uploadPlugin } from '../src'

class TransferXHR {
  static sends = 0
  status = 200
  statusText = 'OK'
  response = new Blob(['ok'])
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onprogress: ((event: ProgressEvent) => void) | null = null
  onload: (() => void) | null = null
  open() {}
  setRequestHeader() {}
  getAllResponseHeaders() { return 'content-type: application/octet-stream\r\n' }
  send() {
    TransferXHR.sends++
    this.upload.onprogress?.({ loaded: 1, total: 1, lengthComputable: true } as ProgressEvent)
    this.onprogress?.({ loaded: 2, total: 2, lengthComputable: true } as ProgressEvent)
    this.onload?.()
  }
  abort() {}
}

afterEach(() => vi.unstubAllGlobals())

it.each(['auto', 'xhr'] as const)('shares one %s transfer for upload and download progress in either plugin order', async transport => {
  for (const reverse of [false, true]) {
    TransferXHR.sends = 0
    vi.stubGlobal('XMLHttpRequest', TransferXHR)
    const fetch = vi.fn()
    const client = createClient({ fetch })
    const plugins = [uploadPlugin(), downloadPlugin({ transport })]
    for (const plugin of reverse ? plugins.reverse() : plugins) client.use(plugin)
    const upload = vi.fn()
    const download = vi.fn()
    const blob = await client.post<Blob>('/transfer', {
      extensions: {
        upload: { data: { file: new Blob(['a']) }, onProgress: upload },
        download: { onProgress: download }
      }
    })
    expect(await blob.text()).toBe('ok')
    expect(TransferXHR.sends).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalledExactlyOnceWith({ loaded: 1, total: 1, bytes: 1, progress: 1 })
    expect(download).toHaveBeenCalledExactlyOnceWith({ loaded: 2, total: 2, bytes: 2, progress: 1 })
  }
})

it.each([
  { transport: 'fetch' as const, output: 'blob' as const },
  { transport: 'auto' as const, output: 'stream' as const },
  { transport: 'fetch' as const, output: 'stream' as const }
])('rejects upload progress with $transport/$output before network I/O', async ({ transport, output }) => {
  for (const reverse of [false, true]) {
    TransferXHR.sends = 0
    vi.stubGlobal('XMLHttpRequest', TransferXHR)
    const fetch = vi.fn()
    const client = createClient({ fetch })
    const plugins = [uploadPlugin(), downloadPlugin({ transport })]
    for (const plugin of reverse ? plugins.reverse() : plugins) client.use(plugin)
    await expect(client.post('/transfer', {
      extensions: {
        upload: { data: {}, onProgress() {} }, download: { output }
      }
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(TransferXHR.sends).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  }
})

it('snapshots reusable producer buffers before assembling a download Blob', async () => {
  const buffer = new Uint8Array(2)
  let index = 0
  let consumed!: () => void
  let acknowledged = new Promise<void>(resolve => { consumed = resolve })
  const source = new ReadableStream({
    async pull(controller) {
      if (index === 2) { controller.close(); return }
      if (index > 0) await acknowledged
      acknowledged = new Promise<void>(resolve => { consumed = resolve })
      buffer.fill(index++ === 0 ? 65 : 66)
      controller.enqueue(buffer)
    }
  }, { highWaterMark: 0 })
  const client = createClient({ fetch: async () => new Response(source) }).use(downloadPlugin())
  const blob = await client.get<Blob>('/download', { extensions: { download: { onProgress() { consumed() } } } })
  expect(await blob.text()).toBe('AABB')
})

it.each(['blob', 'stream'] as const)('omits encoded totals for a real gzip %s download', async output => {
  const compressed = gzipSync('a'.repeat(10000))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': compressed.length })
    response.end(compressed)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const progress = vi.fn()
    const address = server.address() as { port: number }
    const data = await createClient().use(downloadPlugin()).get<Blob | ReadableStream>(`http://127.0.0.1:${address.port}`, {
      extensions: { download: { output, onProgress: progress } }
    })
    const text = data instanceof Blob ? await data.text() : await new Response(data).text()
    expect(text).toBe('a'.repeat(10000))
    expect(progress).toHaveBeenCalled()
    const last = progress.mock.lastCall![0]
    expect(last.loaded).toBe(10000)
    expect(last.total).toBeUndefined()
    expect(last.progress).toBeUndefined()
    expect(last.estimated).toBeUndefined()
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
