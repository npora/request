import { expect, test } from '@playwright/test'

test('inherits cancellation while waiting to reconnect an SSE stream', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createClient } = await import('/dist/index.js')
    const controller = new AbortController()
    let connections = 0
    const states: string[] = []
    const client = createClient({
      signal: controller.signal,
      totalTimeout: 5000,
      fetch: async () => {
        connections++
        return new Response('data: first\n\n', {
          headers: { 'content-type': 'text/event-stream' }
        })
      }
    }).extend()
    const events = await client.sse('/unused', {
      reconnect: { maxAttempts: 1, delay: 1000 },
      onStateChange: (state: string) => states.push(state)
    })
    const iterator = events[Symbol.asyncIterator]()
    await iterator.next()
    let outcome = 'pending'
    void iterator.next().then(
      () => { outcome = 'resolved' },
      (error: { code: string }) => { outcome = error.code }
    )
    // Drain the stream's EOF microtasks before aborting the reconnect wait.
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 0))
    return { outcome, connections, states }
  })
  expect(result).toEqual({ outcome: 'ABORT_ERROR', connections: 1,
    states: ['connecting', 'open', 'reconnecting', 'closed'] })
})
