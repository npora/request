import { describe, expect, it, vi } from 'vitest'
import { concurrencyPlugin, createClient, retryPlugin } from '../src'

describe.each([false, true])('plugin composition cancellation (totalTimeout: %s)', totalTimeout => {
  it.each(['policy', 'delay', 'jitter'] as const)(
    'stops late retry callbacks after cancellation during asynchronous %s and releases its permit',
    async stage => {
      let resolve!: (value: number) => void
      const gate = new Promise<number>(done => { resolve = done })
      let markEntered!: () => void
      const started = new Promise<void>(done => { markEntered = done })
      const entered = vi.fn(markEntered)
      const delay = vi.fn(() => {
        if (stage !== 'delay') return 0
        entered()
        return gate
      })
      const jitter = vi.fn(() => { entered(); return gate })
      const onRetry = vi.fn()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/busy')
          ? new Response('Busy', { status: 503 })
          : new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))
      const permits = concurrencyPlugin({ maxConcurrent: 1 })
      const api = createClient({ fetch: fetchMock }).use(permits).use(retryPlugin({
        retries: 1,
        shouldRetry: () => {
          if (stage !== 'policy') return true
          entered()
          return gate.then(() => true)
        },
        delay,
        jitter: stage === 'jitter' ? jitter : false,
        onRetry
      }))
      const controller = new AbortController()
      const cancelled = api.get('/busy', {
        signal: controller.signal,
        ...(totalTimeout ? { totalTimeout: 100 } : {})
      }).catch(error => error)
      const queued = api.get('/healthy')
      await started
      expect(entered).toHaveBeenCalledTimes(1)
      expect(permits.getState('default')).toEqual({ active: 1, queued: 1 })

      if (!totalTimeout) controller.abort('cancel pending retry work')
      expect(await cancelled).toMatchObject({ code: totalTimeout ? 'TIMEOUT_ERROR' : 'ABORT_ERROR' })
      await expect(queued).resolves.toEqual({ ok: true })
      expect(permits.getState('default')).toEqual({ active: 0, queued: 0 })
      resolve(0)
      await new Promise(done => setTimeout(done, 0))

      expect(onRetry).not.toHaveBeenCalled()
      if (stage === 'policy') expect(delay).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )
})
