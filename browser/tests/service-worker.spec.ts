import { expect, test } from '@playwright/test'

test('runs request contracts in a real Service Worker', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/runtime-worker.js', { scope: '/runtime-scope/' })
    try {
      const worker = registration.installing ?? registration.waiting ?? registration.active!
      if (worker.state !== 'activated') {
        await new Promise<void>((resolve, reject) => {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') resolve()
            if (worker.state === 'redundant') reject(new Error('Service Worker installation failed'))
          })
        })
      }
      return await new Promise((resolve, reject) => {
        const channel = new MessageChannel()
        const timer = setTimeout(() => reject(new Error('Worker contract timed out')), 15000)
        channel.port1.onmessage = event => {
          clearTimeout(timer)
          channel.port1.close()
          resolve(event.data)
        }
        worker.postMessage('run', [channel.port2])
      })
    } finally {
      await registration.unregister()
    }
  })
  expect(result).toMatchObject({ result: {
    json: true, schema: true, formData: true, abort: true, timeout: true,
    sse: true, ndjson: true, tieredCache: true, formErrors: true
  } })
})
