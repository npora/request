import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, RequestError } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('timeout and abort', () => {
  it('should throw TIMEOUT_ERROR when request exceeds timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason)
          })
        })
      })
    )

    const request = createClient({
      timeout: 10
    })

    await expect(request.get('/timeout')).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR'
    })
  })

  it('should allow request when timeout is not exceeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )

    const request = createClient({
      timeout: 1000
    })

    const data = await request.get<{ ok: boolean }>('/success')

    expect(data).toEqual({ ok: true })
  })

  it('should support external abort signal', async () => {
    const controller = new AbortController()

    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason)
          })
        })
      })
    )

    const request = createClient()

    const promise = request.get('/abort', {
      signal: controller.signal
    })

    setTimeout(() => {
      controller.abort(
        new RequestError('User aborted', {
          code: 'ABORT_ERROR'
        })
      )
    }, 0)

    await expect(promise).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
  })
})
