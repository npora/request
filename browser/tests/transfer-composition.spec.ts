import { expect, test } from '@playwright/test'

for (const transport of ['auto', 'xhr'] as const) {
  for (const reverse of [false, true]) {
    test(`shares real upload/download progress (${transport}, reverse=${reverse})`, async ({ page }) => {
      await page.goto('/')
      const result = await page.evaluate(async ({ transport, reverse }) => {
        const moduleURL = `${location.origin}/dist/index.js`
        const { createClient, uploadPlugin, downloadPlugin } = await import(moduleURL)
        const client = createClient({ baseURL: '/api' })
        const plugins = [uploadPlugin(), downloadPlugin({ transport })]
        for (const plugin of reverse ? plugins.reverse() : plugins) client.use(plugin)
        const upload: number[] = [], download: number[] = []
        const response = await client.post('/upload', {
          extensions: {
            upload: { data: { file: new Blob([new Uint8Array(64 * 1024)]) }, onProgress: (p: { loaded: number }) => upload.push(p.loaded) },
            download: { onProgress: (p: { loaded: number }) => download.push(p.loaded) }
          }
        })
        return { data: JSON.parse(await response.text()), upload, download }
      }, { transport, reverse })
      expect(result.data.received).toBeGreaterThan(64 * 1024)
      expect(result.data.contentType).toContain('multipart/form-data; boundary=')
      expect(result.upload.at(-1)).toBeGreaterThan(64 * 1024)
      expect(result.download.at(-1)).toBeGreaterThan(0)
    })
  }
}

test('rejects incompatible stream uploads before issuing a request', async ({ page }) => {
  await page.goto('/')
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/upload')) requests.push(request.url()) })
  const codes = await page.evaluate(async () => {
    const moduleURL = `${location.origin}/dist/index.js`
    const { createClient, uploadPlugin, downloadPlugin } = await import(moduleURL)
    const codes: string[] = []
    for (const reverse of [false, true]) {
      for (const transport of ['auto', 'fetch']) {
        const client = createClient({ baseURL: '/api' })
        const plugins = [uploadPlugin(), downloadPlugin({ transport })]
        for (const plugin of reverse ? plugins.reverse() : plugins) client.use(plugin)
        try {
          await client.post('/upload', { extensions: {
            upload: { data: {}, onProgress() {} }, download: { output: 'stream' }
          } })
          codes.push('unexpected success')
        } catch (error) { codes.push((error as { code: string }).code) }
      }
    }
    return codes
  })
  expect(codes).toEqual(Array(4).fill('CONFIG_ERROR'))
  expect(requests).toEqual([])
})

for (const output of ['blob', 'stream'] as const) {
  test(`decodes gzip ${output} without mixing encoded and decoded totals`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async output => {
      const moduleURL = `${location.origin}/dist/index.js`
      const { createClient, downloadPlugin } = await import(moduleURL)
      const progress: { loaded: number; total?: number; progress?: number; estimated?: number }[] = []
      const data = await createClient({ baseURL: '/api' }).use(downloadPlugin()).get('/compressed-download', {
        extensions: { download: { output, onProgress: (p: typeof progress[number]) => progress.push(p) } }
      })
      const size = data instanceof Blob ? data.size : (await new Response(data).arrayBuffer()).byteLength
      return { size, last: progress.at(-1) }
    }, output)
    expect(result.size).toBe(64 * 1024)
    expect(result.last?.loaded).toBe(64 * 1024)
    expect(result.last?.total).toBeUndefined()
    expect(result.last?.progress).toBeUndefined()
    expect(result.last?.estimated).toBeUndefined()
  })
}
