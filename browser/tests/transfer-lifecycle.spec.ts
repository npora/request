import { expect, test } from '@playwright/test'

for (const reverse of [false, true]) {
  test(`replays the same multipart file through 401/refresh/503/retry/200 (reverse=${reverse})`, async ({ page }) => {
    await page.goto('/')
    const requests: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/transfer-')) requests.push(path)
    })
    const result = await page.evaluate(async reverse => {
      const moduleURL = `${location.origin}/dist/index.js`
      const { createClient, authPlugin, retryPlugin, uploadPlugin, downloadPlugin } = await import(moduleURL)
      let token = 'expired', attempt = 0, refreshes = 0
      const upload: { attempt: number; loaded: number; bytes: number }[] = []
      const download: typeof upload = []
      const plugins = [authPlugin({ token: () => token, refreshToken: async () => {
        refreshes++
        token = (await (await fetch('/api/transfer-refresh', { method: 'POST' })).json()).token
        return token
      } }), retryPlugin({ retries: 2, methods: ['POST'], delay: 0 }), uploadPlugin(), downloadPlugin()]
      const client = createClient({ baseURL: '/api' })
      for (const plugin of reverse ? plugins.reverse() : plugins) client.use(plugin)
      client.use({ name: 'attempt-observer', install({ hooks }: any) {
        hooks.onTransport((context: { attempt: number }) => { attempt = context.attempt }, { priority: Number.MAX_SAFE_INTEGER })
      } })
      const bytes = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251)
      const expectedHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(value => value.toString(16).padStart(2, '0')).join('')
      const data = new FormData()
      data.append('file', new Blob([bytes]), 'payload.bin')
      data.append('label', 'alpha'); data.append('label', 'beta')
      const blob = await client.post('/transfer-replay', { query: { run: crypto.randomUUID() }, extensions: {
        upload: { data, onProgress: (p: { loaded: number; bytes: number }) => upload.push({ ...p, attempt }) },
        download: { onProgress: (p: { loaded: number; bytes: number }) => download.push({ ...p, attempt }) }
      } })
      return { ...(JSON.parse(await blob.text())), expectedHash, refreshes, upload, download }
    }, reverse)
    expect(result.refreshes).toBe(1)
    expect(result.records.map((record: any) => record.status)).toEqual([401, 503, 200])
    expect(result.records.map((record: any) => record.authorization)).toEqual(['Bearer expired', 'Bearer fresh', 'Bearer fresh'])
    for (const record of result.records) {
      expect(record.hash).toBe(result.expectedHash)
      expect(record.size).toBe(64 * 1024)
      expect(record.name).toBe('payload.bin')
      expect(record.labels).toEqual(['alpha', 'beta'])
    }
    for (const direction of [result.upload, result.download]) {
      for (const attempt of [0, 1, 2]) {
        const events = direction.filter((event: any) => event.attempt === attempt)
        expect(events.length).toBeGreaterThan(0)
        expect(events.reduce((sum: number, event: any) => sum + event.bytes, 0)).toBe(events.at(-1).loaded)
      }
    }
    expect(requests.filter(path => path === '/api/transfer-replay')).toHaveLength(3)
    expect(requests.filter(path => path === '/api/transfer-refresh')).toHaveLength(1)
  })
}

test('progress failures settle and unlock readers even when source cleanup never finishes', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const moduleURL = `${location.origin}/dist/index.js`
    const { createClient, downloadPlugin } = await import(moduleURL)
    const results = []
    for (const output of ['blob', 'stream']) {
      const failure = new Error('progress failure')
      let cancelled = 0, wrapped!: ReadableStream
      const source = new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array([1])) },
        cancel() { cancelled++; return new Promise<void>(() => {}) }
      }, { highWaterMark: 0 })
      const client = createClient({ fetch: async () => new Response(source) })
        .use({ name: 'capture', install({ hooks }: any) {
          hooks.onResponse((context: any) => { wrapped = context.response.data }, { requiresRawResponse: false })
        } }).use(downloadPlugin())
      const pending = client.get('/download', { extensions: { download: { output, onProgress() { throw failure } } } })
        .then(async (value: any) => {
          if (output === 'stream') {
            const reader = value.getReader()
            try { await reader.read() } finally { reader.releaseLock() }
          }
          return false
        }, (error: unknown) => error === failure).catch((error: unknown) => error === failure)
      let timer!: ReturnType<typeof setTimeout>
      const settled = await Promise.race([pending, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000) })])
      clearTimeout(timer)
      results.push({ settled, cancelled, sourceLocked: source.locked, wrappedLocked: wrapped.locked })
    }
    return results
  })
  expect(result).toEqual(Array(2).fill({ settled: true, cancelled: 1, sourceLocked: false, wrappedLocked: false }))
})

test('consumer reads bound a virtual multi-gigabyte download and cancellation stops production', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const moduleURL = `${location.origin}/dist/index.js`
    const { createClient, downloadPlugin } = await import(moduleURL)
    let pulls = 0, cancelled = 0, progress = 0, loaded = 0
    const source = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(64 * 1024)) },
      cancel() { cancelled++ }
    }, { highWaterMark: 0 })
    const client = createClient({ fetch: async () => new Response(source, { headers: { 'content-length': String(100000 * 64 * 1024) } }) })
      .use(downloadPlugin())
    const stream = await client.get('/large', { extensions: { download: { output: 'stream',
      onProgress(p: { loaded: number }) { progress++; loaded = p.loaded }
    } } })
    const initial = { pulls, progress }
    const reader = stream.getReader()
    for (let index = 0; index < 3; index++) await reader.read()
    const consumed = { pulls, progress, loaded }
    await reader.cancel('done'); reader.releaseLock()
    const stoppedAt = pulls
    await Promise.resolve()
    return { initial, consumed, cancelled, stopped: stoppedAt === pulls, locked: source.locked }
  })
  expect(result.initial.progress).toBe(0)
  expect(result.initial.pulls).toBeLessThanOrEqual(4)
  expect(result.consumed.pulls).toBeLessThanOrEqual(7)
  expect(result.consumed.progress).toBe(3)
  expect(result.consumed.loaded).toBe(3 * 64 * 1024)
  expect(result.cancelled).toBe(1)
  expect(result.stopped).toBe(true)
  expect(result.locked).toBe(false)
})

test('aborts a real active upload without refresh, retry or late progress', async ({ page }) => {
  await page.goto('/')
  const requests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/transfer-')) requests.push(request.url()) })
  const result = await page.evaluate(async () => {
    const moduleURL = `${location.origin}/dist/index.js`
    const { createClient, authPlugin, retryPlugin, uploadPlugin, downloadPlugin } = await import(moduleURL)
    const controller = new AbortController()
    let progress = 0, refreshes = 0
    const client = createClient({ baseURL: '/api' })
      .use(authPlugin({ token: 'fresh', refreshToken: async () => { refreshes++; return 'fresh' } }))
      .use(retryPlugin({ retries: 2, methods: ['POST'], delay: 0 })).use(uploadPlugin()).use(downloadPlugin())
    const code = await client.post('/transfer-replay', { signal: controller.signal,
      query: { run: crypto.randomUUID(), wait: 1000 }, extensions: {
        upload: { data: { file: new Blob([new Uint8Array(64 * 1024)]) }, onProgress() { progress++; controller.abort('stop active upload') } },
        download: { onProgress() { progress++ } }
      }
    }).then(() => 'unexpected success', (error: { code: string }) => error.code)
    const settledAt = progress
    await new Promise(resolve => setTimeout(resolve, 50))
    return { code, refreshes, progress, settledAt }
  })
  expect(result.code).toBe('ABORT_ERROR')
  expect(result.refreshes).toBe(0)
  expect(result.progress).toBeGreaterThan(0)
  expect(result.progress).toBe(result.settledAt)
  expect(requests).toHaveLength(1)
})

test('aborts a real auth-replayed transfer while waiting for its transient retry', async ({ page }) => {
  await page.goto('/')
  const requests: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/transfer-')) requests.push(path)
  })
  const result = await page.evaluate(async () => {
    const moduleURL = `${location.origin}/dist/index.js`
    const { createClient, authPlugin, retryPlugin, uploadPlugin, downloadPlugin } = await import(moduleURL)
    const controller = new AbortController()
    let token = 'expired', refreshes = 0, notify!: () => void
    const retrying = new Promise<void>(resolve => { notify = resolve })
    const client = createClient({ baseURL: '/api' })
      .use(authPlugin({ token: () => token, refreshToken: async () => {
        refreshes++
        token = (await (await fetch('/api/transfer-refresh', { method: 'POST' })).json()).token
        return token
      } })).use(retryPlugin({ retries: 2, methods: ['POST'], delay: 30000, onRetry() { notify() } }))
      .use(uploadPlugin()).use(downloadPlugin())
    const pending = client.post('/transfer-replay', { signal: controller.signal, query: { run: crypto.randomUUID() }, extensions: {
      upload: { data: { file: new Blob([new Uint8Array(64 * 1024)]) }, onProgress() {} },
      download: { onProgress() {} }
    } }).then(() => 'unexpected success', (error: { code: string }) => error.code)
    await retrying
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort('stop delayed retry')
    return { code: await pending, refreshes }
  })
  expect(result).toEqual({ code: 'ABORT_ERROR', refreshes: 1 })
  expect(requests.filter(path => path === '/api/transfer-replay')).toHaveLength(2)
  expect(requests.filter(path => path === '/api/transfer-refresh')).toHaveLength(1)
})
