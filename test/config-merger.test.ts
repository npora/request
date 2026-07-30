import { describe, expect, it } from 'vitest'
import { ConfigMerger } from '../src/core/ConfigMerger'

describe('ConfigMerger', () => {
  it('should merge headers case-insensitively', () => {
    const config = ConfigMerger.merge(
      {
        headers: {
          Authorization: 'Bearer default',
          'X-Client': 'npora'
        }
      },
      {
        url: '/user',
        headers: {
          authorization: 'Bearer request'
        }
      }
    )

    const headers = new Headers(config.headers)

    expect(headers.get('authorization')).toBe('Bearer request')
    expect(headers.get('x-client')).toBe('npora')
  })

  it('should isolate merged headers without emitting absent fields', () => {
    const defaults = {
      headers: {
        Authorization: 'Bearer default'
      }
    }
    const first = ConfigMerger.merge(defaults, {
      url: '/first'
    })
    const firstHeaders = first.headers as Record<string, string>

    firstHeaders.authorization = 'Bearer changed'
    firstHeaders['x-request'] = 'first'

    const second = ConfigMerger.merge(defaults, {
      url: '/second'
    })

    expect(new Headers(second.headers).get('authorization')).toBe(
      'Bearer default'
    )
    expect(new Headers(second.headers).get('x-request')).toBeNull()
    expect(defaults.headers.Authorization).toBe('Bearer default')
    expect(Object.keys(
      ConfigMerger.merge({}, {
        url: '/minimal'
      })
    )).toEqual(['url'])
  })

  it('should apply the last case-insensitive tuple header', () => {
    const config = ConfigMerger.merge(
      {
        headers: [
          ['X-Mode', 'default']
        ]
      },
      {
        url: '/headers',
        headers: [
          ['x-mode', 'request'],
          ['X-MODE', 'final'],
          ['__proto__', 'safe']
        ]
      }
    )

    expect(new Headers(config.headers).get('x-mode')).toBe('final')
    expect(
      Object.getOwnPropertyDescriptor(
        config.headers,
        '__proto__'
      )?.value
    ).toBe('safe')
    expect(Object.getPrototypeOf(config.headers)).toBe(
      Object.prototype
    )
  })

  it('should merge default and request query parameters', () => {
    const config = ConfigMerger.merge(
      {
        query: {
          locale: 'en',
          page: 1
        }
      },
      {
        url: '/users',
        query: {
          page: 2,
          keyword: 'request'
        }
      }
    )

    expect(config.query).toEqual({
      locale: 'en',
      page: 2,
      keyword: 'request'
    })
  })

  it('should merge nested extension options', () => {
    const config = ConfigMerger.merge(
      {
        retry: 2,
        cache: {
          enabled: true,
          ttl: 30000
        },
        auth: {
          token: 'default-token',
          scheme: 'Bearer'
        }
      },
      {
        url: '/user',
        retry: {
          delay: 0
        },
        cache: {
          ttl: 1000
        },
        auth: {
          token: 'request-token'
        }
      }
    )

    expect(config.retry).toMatchObject({
      retries: 2,
      delay: 0
    })
    expect(config.cache).toEqual({
      enabled: true,
      ttl: 1000
    })
    expect(config.auth).toEqual({
      token: 'request-token',
      scheme: 'Bearer'
    })
  })

  it('should merge namespaced extension options by plugin key', () => {
    const config = ConfigMerger.merge(
      {
        extensions: {
          retry: {
            retries: 2,
            delay: 300
          },
          logger: {
            enabled: true
          }
        }
      },
      {
        url: '/user',
        extensions: {
          retry: {
            delay: 0
          },
          logger: {
            enabled: false
          }
        }
      }
    )

    expect(config.extensions).toEqual({
      retry: {
        retries: 2,
        delay: 0
      },
      logger: {
        enabled: false
      }
    })
  })

  it('should replace the default body mode when a request supplies one', () => {
    const config = ConfigMerger.merge(
      {
        json: {
          source: 'default'
        }
      },
      {
        url: '/submit',
        method: 'POST',
        form: {
          source: 'request'
        }
      }
    )

    expect(config.json).toBeUndefined()
    expect(config.form).toEqual({
      source: 'request'
    })
  })

  it('should clear a default body mode when explicitly set to undefined', () => {
    const config = ConfigMerger.merge(
      {
        json: {
          source: 'default'
        }
      },
      {
        url: '/submit',
        method: 'POST',
        json: undefined
      }
    )

    expect(config.json).toBeUndefined()
    expect(config.body).toBeUndefined()
    expect(config.form).toBeUndefined()
    expect(config.formData).toBeUndefined()
  })
})
