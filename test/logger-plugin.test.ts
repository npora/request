import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, loggerPlugin } from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('loggerPlugin', () => {
  it('should log request and response', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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

    const request = createClient().use(loggerPlugin())

    await request.get('/user')

    expect(logSpy).toHaveBeenCalledTimes(2)

    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      '[Npora Request]',
      expect.objectContaining({
        type: 'request',
        method: 'GET',
        url: '/user'
      })
    )

    expect(logSpy).toHaveBeenNthCalledWith(
      2,
      '[Npora Request]',
      expect.objectContaining({
        type: 'response',
        method: 'GET',
        url: '/user',
        status: 200
      })
    )
  })

  it('should not log when logger is disabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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

    const request = createClient().use(loggerPlugin())

    await request.get('/user', {
      logger: {
        enabled: false
      }
    })

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('should log error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const request = createClient().use(loggerPlugin())

    await expect(request.get('/error')).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })

    expect(logSpy).toHaveBeenCalledTimes(1)

    expect(errorSpy).toHaveBeenCalledTimes(1)

    expect(logSpy).toHaveBeenCalledWith(
      '[Npora Request]',
      expect.objectContaining({
        type: 'request',
        method: 'GET',
        url: '/error'
      })
    )

    expect(errorSpy).toHaveBeenCalledWith(
      '[Npora Request]',
      expect.objectContaining({
        type: 'error'
      })
    )
  })
})
