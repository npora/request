import { expect, test } from '@playwright/test'

for (const stage of ['request interceptor', 'response interceptor', 'schema'] as const) {
  test(`cancels a pending ${stage} without totalTimeout`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async stage => {
      const { createClient } = await import('/dist/index.js')
      const controller = new AbortController()
      let enter!: () => void
      const entered = new Promise<void>(resolve => { enter = resolve })
      let finish!: () => void
      const gate = new Promise<void>(resolve => { finish = resolve })
      let laterCalls = 0
      let fetchCalls = 0
      const client = createClient({
        fetch: async () => {
          fetchCalls += 1
          return new Response('{}', { headers: { 'content-type': 'application/json' } })
        }
      })
      if (stage === 'request interceptor') {
        client.interceptors.request.use(async config => {
          enter(); await gate; return config
        })
        client.interceptors.request.use(config => { laterCalls += 1; return config })
      } else if (stage === 'response interceptor') {
        client.interceptors.response.use(async response => {
          enter(); await gate; return response
        })
        client.interceptors.response.use(response => { laterCalls += 1; return response })
      }
      const schema = {
        '~standard': {
          version: 1 as const,
          vendor: 'browser-test',
          async validate(value: unknown) { enter(); await gate; return { value } }
        }
      }
      const pending = client.get('/api/user', {
        signal: controller.signal,
        ...(stage === 'schema' ? { schema } : {})
      }).then(() => 'resolved', (error: { code: string }) => error.code)
      await entered
      controller.abort()
      const code = await pending
      finish()
      await new Promise(resolve => setTimeout(resolve, 0))
      return { code, laterCalls, fetchCalls }
    }, stage)
    expect(result).toEqual({
      code: 'ABORT_ERROR',
      laterCalls: 0,
      fetchCalls: stage === 'request interceptor' ? 0 : 1
    })
  })
}
