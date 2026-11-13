import { expect, test } from '@playwright/test'

for (const mutation of ['clear', 'delete', 'tags', 'replace'] as const) {
  test(`IndexedDB ${mutation} invalidates an older asynchronous admission`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async mutation => {
      const { IndexedDBCacheStore } = await import('/dist/index.js')
      let entered!: () => void, release!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      const databaseName = `npora-race-${crypto.randomUUID()}`
      const store = new IndexedDBCacheStore(indexedDB, { databaseName,
        shouldPersist: async entry => {
          if (entry.data === 'old') { entered(); await gate }
          return true
        }
      })
      const entry = { data: 'old', expiresAt: Infinity, status: 200, statusText: 'OK', headers: [], tags: ['profile'] }
      try {
        const pending = store.set('profile', entry)
        await started
        if (mutation === 'clear') await store.clear()
        else if (mutation === 'delete') await store.delete('profile')
        else if (mutation === 'tags') await store.invalidateTags(['profile'])
        // A later valid write must survive completion of the abandoned policy.
        await store.set('profile', { ...entry, data: 'new' })
        release()
        await pending
        return { data: (await store.get('profile'))?.data, usage: (await store.getUsage()).entries }
      } finally {
        release?.()
        await store.close()
        indexedDB.deleteDatabase(databaseName)
      }
    }, mutation)
    expect(result).toEqual({ data: 'new', usage: 1 })
  })
}

test('XHR rejects native Request streams before a network dispatch', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createClient, downloadPlugin } = await import('/dist/index.js')
    const input = new Request(`${location.origin}/api/upload`, { method: 'POST', body: 'payload' })
    const api = createClient().use(downloadPlugin({ transport: 'xhr' }))
    try {
      await api.request(input, { extensions: { download: { onProgress() {} } } })
      return { code: 'sent', consumed: input.bodyUsed }
    } catch (error) {
      return { code: (error as { code: string }).code, consumed: input.bodyUsed }
    }
  })
  expect(result).toEqual({ code: 'CONFIG_ERROR', consumed: false })
})

test('metrics preserve pending and unopened streaming cancellation', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { createClient, openTelemetryMetricsPlugin } = await import('/dist/index.js')
    const results = []
    for (const format of ['ndjson', 'sse'] as const) {
      for (const pending of [false, true]) {
        let cancelled = 0, active = 0
        const abort = new AbortController()
        const noop = { add() {}, record() {} }
        const api = createClient({ signal: abort.signal, totalTimeout: 1000,
          fetch: async () => new Response(new ReadableStream({ cancel() { cancelled++ } }))
        }).use(openTelemetryMetricsPlugin({ meter: {
          createCounter: () => noop, createHistogram: () => noop,
          createUpDownCounter: name => ({ add(value) { if (name === 'npora.client.active_streams') active += value } })
        } }))
        const iterator = (await api[format]('/unused'))[Symbol.asyncIterator]()
        const reading = pending ? iterator.next().catch(error => ({ error })) : undefined
        try {
          await new Promise(resolve => setTimeout(resolve, 0))
          await iterator.return!()
          const next = reading && await reading
          results.push({ format, pending, cancelled, active, done: !next || ('done' in next && next.done) })
        } finally { abort.abort(); api.unuse('opentelemetry-metrics') }
      }
    }
    return results
  })
  expect(results).toEqual(['ndjson', 'sse'].flatMap(format => [false, true].map(pending => ({
    format, pending, cancelled: 1, active: 0, done: true
  }))))
})
