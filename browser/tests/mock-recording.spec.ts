import { expect, test } from '@playwright/test'

test('records native browser HTTP and replays its exported mock script offline', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createClient, FetchAdapter } = await import('/dist/core.js')
    const { MockAdapter } = await import('/dist/testing.js')
    const mock = new MockAdapter({ record: { adapter: new FetchAdapter() } })
    const api = createClient({ baseURL: '/api', adapter: mock })
    const real = await api.get('/user')
    const script = mock.exportMocks()
    const offline = new MockAdapter()
    new Function('mock', script)(offline)
    const replayed = await createClient({ adapter: offline }).get('/user')
    return { real, replayed, count: mock.recordings.length, stats: mock.recordingStats }
  })
  expect(result).toEqual({ real: { id: 1, name: 'Npora' }, replayed: { id: 1, name: 'Npora' },
    count: 1, stats: { recorded: 1, skipped: 0 } })
})
