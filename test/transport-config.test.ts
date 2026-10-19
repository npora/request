import { describe, expect, it, vi } from 'vitest'
import { createClient, retryPlugin, type Adapter, type RequestConfig } from '../src'

describe('configuration after transport hooks', () => {
  it.each(['replace config', 'replace headers', 'mutate record', 'mutate Headers'].flatMap(mode => [
    { mode, asynchronous: false }, { mode, asynchronous: true }
  ]))('sends final headers for $mode (async=$asynchronous) on every attempt', async ({ mode, asynchronous }) => {
    const sent: Array<string | null> = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('x-attempt'))
      return sent.length === 1
        ? new Response('{}', { status: 503 })
        : new Response('{}', { headers: { 'content-type': 'application/json' } })
    })
    const originalHeaders = { 'x-attempt': 'original' }
    const client = createClient({ fetch: fetchMock, headers: originalHeaders })
      .use(retryPlugin({ retries: 1, delay: 0 }))
      .use({
        name: 'update-transport',
        install({ hooks }) {
          // Set up each mutable header representation before validation.
          hooks.onRequest(context => {
            context.config.headers = mode === 'mutate Headers'
              ? new Headers(context.config.headers)
              : { 'x-attempt': 'before' }
          })
          hooks.onTransport(context => {
            const mutate = () => {
              const value = String(context.attempt)
              if (mode === 'replace config') {
                context.config = { ...context.config, headers: { 'x-attempt': value } }
              } else if (mode === 'replace headers') {
                context.config.headers = [['x-attempt', value]]
              } else if (mode === 'mutate Headers') {
                ;(context.config.headers as Headers).set('x-attempt', value)
              } else {
                ;(context.config.headers as Record<string, string>)['x-attempt'] = value
              }
            }
            if (asynchronous) return Promise.resolve().then(mutate)
            mutate()
          })
        }
      })

    await client.get('https://example.test/items')
    expect(sent).toEqual(['0', '1'])
    expect(originalHeaders).toEqual({ 'x-attempt': 'original' })
    client.unuse('update-transport')
    await client.get('https://example.test/items')
    expect(sent[2]).toBe('original')
  })

  it.each([
    { field: 'method', mutate: (config: RequestConfig) => { config.method = 'TRACE' as never } },
    { field: 'url', mutate: (config: RequestConfig) => { config.url = null as never } },
    { field: 'headers', mutate: (config: RequestConfig) => { config.headers = { 'bad name': 'value' } } },
    { field: 'body', mutate: (config: RequestConfig) => { config.json = {}; config.body = 'conflict' } },
    { field: 'timeout', mutate: (config: RequestConfig) => { config.timeout = NaN } }
  ])('rejects invalid $field before a custom adapter is called', async ({ mutate }) => {
    const adapter: Adapter = { request: vi.fn() }
    const errors = vi.fn()
    const settled = vi.fn()
    const client = createClient({ adapter }).use({
      name: 'invalid-transport',
      install({ hooks }) {
        hooks.onTransport(context => { mutate(context.config) })
        hooks.onError(errors)
        hooks.onSettled(settled)
      }
    })
    await expect(client.post('https://example.test/items')).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(adapter.request).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('does not call a custom adapter after a transport hook aborts', async () => {
    const controller = new AbortController()
    const adapter: Adapter = { request: vi.fn() }
    const client = createClient({ adapter }).use({
      name: 'abort-transport',
      install({ hooks }) {
        hooks.onTransport(async () => { controller.abort() })
      }
    })
    await expect(client.get('https://example.test', {
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    expect(adapter.request).not.toHaveBeenCalled()
  })
})
