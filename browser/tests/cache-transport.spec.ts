import { expect, test } from '@playwright/test'

test('isolates cached cookie responses by credential mode', async ({ page, context }) => {
  await context.addCookies([{
    name: 'cache-session', value: 'alice', url: 'http://localhost:4173'
  }])
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createClient, cachePlugin } = await import('/dist/index.js')
    let calls = 0
    const client = createClient({
      fetch: (input, init) => {
        calls += 1
        return window.fetch(input, init)
      },
      extensions: { cache: { enabled: true, ttl: 60000 } }
    }).use(cachePlugin())
    const responses: Array<{ cookie: string }> = []
    for (const credentials of ['include', 'omit', 'same-origin', 'include', 'omit'] as const) {
      responses.push(await client.get('/api/cache-identity', {
        // Disable the browser HTTP cache so this checks the plugin cache.
        fetchOptions: { credentials, cache: 'no-store' }
      }))
    }
    return { responses, calls }
  })
  expect(result).toEqual({
    responses: [
      { cookie: 'cache-session=alice' }, { cookie: '' },
      { cookie: 'cache-session=alice' }, { cookie: 'cache-session=alice' },
      { cookie: '' }
    ],
    calls: 3
  })
})

for (const constraint of ['integrity', 'redirect'] as const) {
  test(`preserves native ${constraint} checks after warming cache`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async constraint => {
      const { createClient, cachePlugin } = await import('/dist/index.js')
      let calls = 0
      const client = createClient({
        fetch: (input, init) => {
          calls += 1
          return window.fetch(input, init)
        },
        extensions: { cache: { enabled: true, ttl: 60000 } }
      }).use(cachePlugin())
      const url = constraint === 'redirect' ? '/api/cache-redirect' : '/api/cache-identity'
      await client.get(url)
      try {
        await client.get(url, {
          fetchOptions: constraint === 'redirect'
            ? { redirect: 'error' }
            : { integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }
        })
        return { rejected: false, calls }
      } catch (error) {
        return { rejected: true, calls, code: (error as { code?: string }).code }
      }
    }, constraint)
    expect(result).toEqual({ rejected: true, calls: 2, code: 'NETWORK_ERROR' })
  })
}
