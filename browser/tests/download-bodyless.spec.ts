import { expect, test } from '@playwright/test'

test('handles bodyless downloads with and without progress reporting', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { createClient, downloadPlugin } = await import('/dist/index.js')
    const results = []
    for (const kind of ['HEAD', '204', '205', '304']) {
      for (const streamed of [false, true]) {
        const progress: unknown[] = []
        const client = createClient({
          throwHttpErrors: false,
          fetch: async () => new Response(null, {
            status: kind === 'HEAD' ? 200 : Number(kind),
            headers: { 'content-length': '123' }
          })
        }).use(downloadPlugin())
        const response = await client.requestResponse({
          url: '/unused', method: kind === 'HEAD' ? 'HEAD' : 'GET',
          extensions: { download: streamed
            ? { output: 'stream' as const }
            : { onProgress: (event: unknown) => progress.push(event) }
          }
        })
        let empty = response.data === undefined
        if (streamed && response.data instanceof ReadableStream) {
          const reader = response.data.getReader()
          try { empty = (await reader.read()).done === true }
          finally { reader.releaseLock() }
        } else if (streamed) {
          empty = false
        }
        results.push({ kind, streamed, empty, rawEmpty: response.raw.body === null, progress })
      }
    }
    return results
  })
  expect(results).toEqual(['HEAD', '204', '205', '304'].flatMap(kind => [false, true].map(streamed => ({
    kind, streamed, empty: true, rawEmpty: true,
    progress: streamed ? [] : [{ loaded: 0, total: 0, bytes: 0 }]
  }))))
})
