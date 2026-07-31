import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  loggerPlugin,
  retryPlugin,
  type RequestLogger
} from '../src'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
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
      extensions: {
        logger: {
          enabled: false
        }
      }
    })

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('should read logger options from extensions', async () => {
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
      extensions: {
        logger: {
          enabled: false
        }
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
        type: 'error',
        name: 'RequestError',
        message: 'Network request failed',
        code: 'NETWORK_ERROR',
        method: 'GET',
        url: '/error'
      })
    )
  })

  it('should not log errors when request logging is disabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const request = createClient().use(loggerPlugin())

    await expect(
      request.get('/error', {
        extensions: {
          logger: {
            enabled: false
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })

    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('should redact sensitive URL values and omit secret config', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const request = createClient().use(loggerPlugin())

    await expect(
      request.get(
        '/error?access_token=url-secret&view=full#details',
        {
          headers: {
            authorization: 'Bearer header-secret',
            cookie: 'session=cookie-secret'
          },
          extensions: {
            auth: {
              token: 'config-secret'
            }
          }
        }
      )
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })

    const requestEntry = logSpy.mock.calls[0]?.[1]
    const errorEntry = errorSpy.mock.calls[0]?.[1]
    const serializedLogs = JSON.stringify({
      requestEntry,
      errorEntry
    })

    expect(requestEntry).toMatchObject({
      url:
        '/error?access_token=%5BREDACTED%5D&view=full#details'
    })
    expect(errorEntry).toMatchObject({
      url:
        '/error?access_token=%5BREDACTED%5D&view=full#details'
    })
    expect(serializedLogs).not.toContain('url-secret')
    expect(serializedLogs).not.toContain('header-secret')
    expect(serializedLogs).not.toContain('cookie-secret')
    expect(serializedLogs).not.toContain('config-secret')
  })

  it('should send structured lifecycle entries to a custom logger', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)

    const info = vi.fn<RequestLogger['info']>()
    const error = vi.fn<RequestLogger['error']>()
    const logger: RequestLogger = {
      info,
      error
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        vi.setSystemTime(1250)

        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          })
        )
      })
    )

    const request = createClient().use(
      loggerPlugin({
        logger,
        createRequestId: () => 'request-id'
      })
    )

    await request.get('/user')

    expect(info).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
    expect(info.mock.calls[0]?.[1]).toEqual({
      type: 'request',
      requestId: 'request-id',
      timestamp: 1000,
      method: 'GET',
      url: '/user'
    })
    expect(info.mock.calls[1]?.[1]).toEqual({
      type: 'response',
      requestId: 'request-id',
      timestamp: 1250,
      duration: 250,
      attempts: 1,
      method: 'GET',
      url: '/user',
      status: 200
    })
  })

  it('should correlate retry errors with the completed response', async () => {
    const info = vi.fn<RequestLogger['info']>()
    const error = vi.fn<RequestLogger['error']>()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Unavailable', {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const request = createClient()
      .use(
        loggerPlugin({
          logger: {
            info,
            error
          },
          createRequestId: () => 'retry-request'
        })
      )
      .use(
        retryPlugin({
          retries: 1,
          delay: 0
        })
      )

    await request.get('/retry')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith(
      '[Npora Request]',
      expect.objectContaining({
        type: 'error',
        requestId: 'retry-request',
        attempt: 1,
        status: 503
      })
    )
    expect(info).toHaveBeenLastCalledWith(
      '[Npora Request]',
      expect.objectContaining({
        type: 'response',
        requestId: 'retry-request',
        attempts: 2,
        status: 200
      })
    )
  })

  it('should log configuration errors with lifecycle metadata', async () => {
    const info = vi.fn<RequestLogger['info']>()
    const error = vi.fn<RequestLogger['error']>()
    const request = createClient().use(
      loggerPlugin({
        logger: {
          info,
          error
        },
        createRequestId: () => 'config-request'
      })
    )

    await expect(
      request.get('/invalid', {
        headers: {
          'x-test': 'safe\r\ninjected: value'
        }
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })

    expect(info).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      '[Npora Request]',
      expect.objectContaining({
        type: 'error',
        requestId: 'config-request',
        duration: expect.any(Number),
        attempt: 1,
        code: 'CONFIG_ERROR'
      })
    )
  })

  it('should isolate request failures from logger failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )

    const request = createClient().use(
      loggerPlugin({
        logger: {
          info() {
            throw new Error('logger info failed')
          },
          async error() {
            throw new Error('logger error failed')
          }
        }
      })
    )

    await expect(request.get('/error')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Network request failed'
    })
  })
})
