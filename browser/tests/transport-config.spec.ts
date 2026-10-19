import { expect, test } from '@playwright/test'

for (const asynchronous of [false, true]) {
  test(`sends transport-hook headers on first and retry attempts (async=${asynchronous})`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async asynchronous => {
      const { createClient, retryPlugin } = await import('/dist/index.js')
      const sent: Array<string | null> = []
      const client = createClient({
        baseURL: '/api',
        headers: { 'x-attempt': 'original' },
        fetch: async (input, init) => {
          sent.push(new Headers(init?.headers).get('x-attempt'))
          if (sent.length === 1) return new Response('{}', { status: 503 })
          return window.fetch(input, init)
        }
      }).use(retryPlugin({ retries: 1, delay: 0 })).use({
        name: 'transport-header',
        install({ hooks }) {
          hooks.onTransport(context => {
            const update = () => {
              context.config.headers = { 'x-attempt': String(context.attempt) }
            }
            if (asynchronous) return Promise.resolve().then(update)
            update()
          })
        }
      })
      const response = await client.get<{ headers: Record<string, string> }>('/echo')
      client.unuse('transport-header')
      await client.get('/echo')
      return { sent, serverHeader: response.headers['x-attempt'] }
    }, asynchronous)
    expect(result).toEqual({ sent: ['0', '1', 'original'], serverHeader: '1' })
  })
}
