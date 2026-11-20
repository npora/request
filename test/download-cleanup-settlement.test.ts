import { afterEach, expect, it, vi } from 'vitest'
import { authPlugin, concurrencyPlugin, createClient, downloadPlugin, retryPlugin } from '../src'

afterEach(() => vi.useRealTimers())

it.each((['blob', 'stream'] as const).flatMap(output => [false, true].map(rejectCleanup => ({ output, rejectCleanup }))))(
  'settles $output progress failures independently of cleanup (late rejection=$rejectCleanup)', async ({ output, rejectCleanup }) => {
  vi.useFakeTimers()
  const failure = new Error('UI progress failure')
  let rejectCancel!: (error: Error) => void
  const cancel = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectCancel = reject }))
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array([1])) }, cancel
  }, { highWaterMark: 0 })
  let wrapped!: ReadableStream<Uint8Array>
  const progress = vi.fn(() => { throw failure })
  const client = createClient({ fetch: async () => new Response(source) })
    .use({ name: 'capture-stream', install({ hooks }) {
      hooks.onResponse(context => { wrapped = context.response!.data as ReadableStream<Uint8Array> }, { requiresRawResponse: false })
    } })
    .use(downloadPlugin())
  const request = client.get<Blob | ReadableStream<Uint8Array>>('/download', {
    extensions: { download: { output, onProgress: progress } }
  })
  const pending = (output === 'stream'
    ? request.then(data => {
      const reader = (data as ReadableStream<Uint8Array>).getReader()
      return reader.read().finally(() => reader.releaseLock())
    })
    : request).then(() => 'unexpected success', error => error)

  await vi.waitFor(() => expect(progress).toHaveBeenCalledOnce())
  const outcome = Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve('still pending'), 25))
  ])
  await vi.advanceTimersByTimeAsync(25)
  expect(await outcome).toBe(failure)
  expect(cancel).toHaveBeenCalledExactlyOnceWith(failure)
  expect(source.locked).toBe(false)
  expect(wrapped.locked).toBe(false)
  if (rejectCleanup) {
    rejectCancel(new Error('late source cleanup failure'))
    await Promise.resolve()
  }
})

it('keeps a virtual multi-gigabyte download bounded by consumer reads', async () => {
  const chunkSize = 64 * 1024
  let pulls = 0
  const cancel = vi.fn()
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(chunkSize)) }, cancel
  }, { highWaterMark: 0 })
  const progress = vi.fn()
  const client = createClient({ fetch: async () => new Response(source, {
    headers: { 'content-length': String(100000 * chunkSize) }
  }) }).use(downloadPlugin())
  const stream = await client.get<ReadableStream<Uint8Array>>('/large', {
    extensions: { download: { output: 'stream', onProgress: progress } }
  })
  expect(pulls).toBeLessThanOrEqual(4)
  expect(progress).not.toHaveBeenCalled()
  const reader = stream.getReader()
  for (let index = 0; index < 3; index++) {
    expect((await reader.read()).value?.byteLength).toBe(chunkSize)
  }
  expect(progress).toHaveBeenCalledTimes(3)
  expect(progress.mock.lastCall![0].loaded).toBe(3 * chunkSize)
  expect(pulls).toBeLessThanOrEqual(7)
  await reader.cancel('enough data')
  reader.releaseLock()
  const stoppedAt = pulls
  await Promise.resolve()
  expect(pulls).toBe(stoppedAt)
  expect(cancel).toHaveBeenCalledExactlyOnceWith('enough data')
  expect(source.locked).toBe(false)
})

it('releases the logical concurrency permit while failed source cleanup remains pending', async () => {
  const failure = new Error('progress failed')
  const source = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array([1])) },
    cancel() { return new Promise<void>(() => {}) }
  }, { highWaterMark: 0 })
  const fetch = vi.fn(async input => String(input).endsWith('/first')
    ? new Response(source) : new Response('next request'))
  const limiter = concurrencyPlugin({ maxConcurrent: 1 })
  const client = createClient({ fetch }).use(limiter).use(downloadPlugin())
  const first = client.get('/first', { extensions: { download: { onProgress() { throw failure } } } })
    .catch(error => error)
  const second = client.get<Blob>('/second', { extensions: { download: { onProgress() {} } } })
  expect(await first).toBe(failure)
  expect(await (await second).text()).toBe('next request')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(limiter.getState('default')).toEqual({ active: 0, queued: 0 })
  expect(source.locked).toBe(false)
})

it.each(['timeout', 'size'] as const)('does not retry or refresh after a returned download stream fails with %s', async kind => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { if (kind === 'size') controller.enqueue(new Uint8Array(40)) }, cancel
  }, { highWaterMark: 0 })
  const fetch = vi.fn(async () => new Response(source))
  const refreshToken = vi.fn(async () => 'fresh')
  const client = createClient({ fetch }).use(authPlugin({ token: 'fresh', refreshToken }))
    .use(retryPlugin({ retries: 2, delay: 0 })).use(downloadPlugin())
  const stream = await client.get<ReadableStream<Uint8Array>>('/stream', {
    ...(kind === 'timeout' ? { timeout: 25 } : { maxResponseSize: 64 }),
    extensions: { download: { output: 'stream', onProgress() {} } }
  })
  const reader = stream.getReader()
  const pending = (async () => { while (!(await reader.read()).done) {} })()
    .catch(error => error).finally(() => reader.releaseLock())
  await vi.advanceTimersByTimeAsync(kind === 'timeout' ? 25 : 0)
  expect(await pending).toMatchObject({ code: kind === 'timeout' ? 'TIMEOUT_ERROR' : 'RESPONSE_TOO_LARGE' })
  expect(fetch).toHaveBeenCalledOnce()
  expect(refreshToken).not.toHaveBeenCalled()
  expect(cancel).toHaveBeenCalledOnce()
  expect(source.locked).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
