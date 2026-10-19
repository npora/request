import { describe, expect, it, vi } from 'vitest'
import {
  concurrencyPlugin,
  createClient,
  type Plugin,
  type StandardSchemaV1
} from '../src'

const stages = [
  'request interceptor', 'response interceptor',
  'schema', 'ndjson schema', 'sse schema'
] as const

describe('lifecycle cancellation without totalTimeout', () => {
  it.each(['request', 'response'] as const)('observes a rejected %s interceptor that aborts synchronously', async stage => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => new Response('{}'))
    const client = createClient({ fetch: fetchMock })
    const after = vi.fn()
    if (stage === 'request') {
      client.interceptors.request.use(() => {
        controller.abort()
        return Promise.reject(new Error('rejected after abort'))
      })
      client.interceptors.request.use(config => { after(); return config })
    } else {
      client.interceptors.response.use(() => {
        controller.abort()
        return Promise.reject(new Error('rejected after abort'))
      })
      client.interceptors.response.use(response => { after(); return response })
    }
    await expect(client.get('https://example.test', {
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    expect(after).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(stage === 'request' ? 0 : 1)
  })

  it.each(stages.flatMap(stage => [
    { stage, lateReject: false }, { stage, lateReject: true }
  ]))('cancels $stage and ignores late rejection=$lateReject', async ({ stage, lateReject }) => {
    let enter!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    let finish!: () => void
    let fail!: (error: Error) => void
    const gate = new Promise<void>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    const pause = () => { enter(); return gate }
    const after = vi.fn()
    const settled = vi.fn()
    const controller = new AbortController()
    const permits = concurrencyPlugin({ maxConcurrent: 1 })
    const fetchMock = vi.fn(async () => {
      if (stage === 'ndjson schema') return new Response('{}\n')
      if (stage === 'sse schema') return new Response('data: hello\n\n')
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })
    const client = createClient({ fetch: fetchMock }).use(permits)
    const plugin: Plugin = {
      name: 'pause',
      install({ hooks }) {
        hooks.onSettled(settled)
      }
    }
    client.use(plugin)
    if (stage === 'request interceptor') {
      client.interceptors.request.use(async config => { await pause(); return config })
      client.interceptors.request.use(config => { after(); return config })
    }
    if (stage === 'response interceptor') {
      client.interceptors.response.use(async response => { await pause(); return response })
      client.interceptors.response.use(response => { after(); return response })
    }
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'cancellation-test',
        async validate(value) { await pause(); return { value } }
      }
    }
    if (stage === 'schema') client.interceptors.response.use(response => { after(); return response })
    const config = { signal: controller.signal }
    const pending = stage === 'ndjson schema'
      ? client.ndjson('https://example.test/items', { ...config, itemSchema: schema })
          .then(async items => { for await (const item of items) after(item) })
      : stage === 'sse schema'
        ? client.sse('https://example.test/events', { ...config, itemSchema: schema })
            .then(async items => { for await (const item of items) after(item) })
        : client.get('https://example.test/data', {
            ...config, ...(stage === 'schema' ? { schema } : {})
          })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
    await entered
    controller.abort()
    await rejected
    expect(settled).toHaveBeenCalledTimes(1)
    expect(permits.getState('https://example.test')).toEqual({ active: 0, queued: 0 })
    expect(after).not.toHaveBeenCalled()
    const attempts = fetchMock.mock.calls.length
    if (stage === 'request interceptor') {
      expect(attempts).toBe(0)
    }
    if (lateReject) fail(new Error('late failure'))
    else finish()
    // Allow late continuations to run; no later hook or transport may start.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(after).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(attempts)
    expect(settled).toHaveBeenCalledTimes(1)
  })
})
