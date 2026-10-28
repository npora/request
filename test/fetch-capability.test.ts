import { afterEach, expect, it, vi } from 'vitest'
import { createClient, MockAdapter, retryPlugin } from '../src'

afterEach(() => vi.unstubAllGlobals())

it.each([undefined, null, {}])('classifies a missing/non-callable global Fetch as configuration: %j', async value => {
  vi.stubGlobal('fetch', value)
  const lookup = vi.fn(() => value)
  Object.defineProperty(globalThis, 'fetch', { configurable: true, get: lookup })
  const onRetry = vi.fn()
  const client = createClient().use(retryPlugin({ retries: 2, delay: 0, onRetry }))
  await expect(client.get('/unavailable', { timeout: 1000 })).rejects.toMatchObject({
    code: 'CONFIG_ERROR', config: { url: '/unavailable' }
  })
  expect(onRetry).not.toHaveBeenCalled()
  expect(lookup).toHaveBeenCalledOnce()
})

it('supports injected Fetch and custom adapters without global Fetch', async () => {
  vi.stubGlobal('fetch', undefined)
  const fetch = vi.fn(async () => Response.json({ injected: true }))
  await expect(createClient({ fetch }).get('/injected')).resolves.toEqual({ injected: true })
  expect(fetch).toHaveBeenCalledOnce()
  const adapter = new MockAdapter()
  adapter.onGet('/custom').reply(200, { custom: true })
  await expect(createClient({ adapter }).get('/custom')).resolves.toEqual({ custom: true })
})

it('preserves caller cancellation before checking transport capabilities', async () => {
  vi.stubGlobal('fetch', undefined)
  const controller = new AbortController()
  controller.abort()
  await expect(createClient().get('/cancelled', { signal: controller.signal }))
    .rejects.toMatchObject({ code: 'ABORT_ERROR' })
})
