import { describe, expect, it } from 'vitest'
import type { RequestConfig } from '../src'
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

  it('should replace inherited query defaults with cloned URLSearchParams', () => {
    const query = new URLSearchParams([
      ['tag', 'first'],
      ['tag', 'second']
    ])
    const config = ConfigMerger.merge(
      {
        query: {
          locale: 'en'
        }
      },
      {
        url: '/users',
        searchParams: query
      }
    )

    query.append('tag', 'changed-after-merge')

    expect(config.query).toBeUndefined()
    expect(config.searchParams?.getAll('tag')).toEqual([
      'first',
      'second'
    ])
  })

  it('should clone inherited URLSearchParams defaults', () => {
    const defaults = new URLSearchParams([
      ['locale', 'en']
    ])
    const first = ConfigMerger.merge({ searchParams: defaults }, {
      url: '/first'
    })

    first.searchParams?.set('locale', 'changed')

    const second = ConfigMerger.merge({ searchParams: defaults }, {
      url: '/second'
    })

    expect(second.searchParams?.get('locale')).toBe('en')
    expect(defaults.get('locale')).toBe('en')
  })

  it('should preserve invalid inherited searchParams for validation', () => {
    const invalidSearchParams = {
      locale: 'en'
    }
    const config = ConfigMerger.merge(
      {
        searchParams: invalidSearchParams as never
      },
      {
        url: '/users'
      }
    )

    expect(config.searchParams).toBe(invalidSearchParams)
  })

  it('should replace inherited searchParams with object query input', () => {
    const config = ConfigMerger.merge(
      {
        searchParams: new URLSearchParams('locale=en')
      },
      {
        url: '/users',
        query: {
          page: 2
        }
      }
    )

    expect(config.query).toEqual({ page: 2 })
    expect(config.searchParams).toBeUndefined()
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

  it('should isolate single-sided extension containers', () => {
    const requestExtensions = {
      cache: {
        enabled: true
      }
    }
    const defaultExtensions = {
      retry: {
        retries: 2
      }
    }
    const requestConfig = ConfigMerger.merge({}, {
      url: '/request',
      extensions: requestExtensions
    })
    const defaultConfig = ConfigMerger.mergeDefaults({
      extensions: defaultExtensions
    }, {})

    expect(requestConfig.extensions).toEqual(requestExtensions)
    expect(requestConfig.extensions).not.toBe(requestExtensions)
    expect(defaultConfig.extensions).toEqual(defaultExtensions)
    expect(defaultConfig.extensions).not.toBe(defaultExtensions)
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

  it('should ignore body fields inherited from the request prototype', () => {
    const request = Object.assign(
      Object.create({
        json: {
          source: 'prototype'
        }
      }) as Record<string, unknown>,
      {
        url: '/submit',
        method: 'POST'
      }
    ) as RequestConfig
    const config = ConfigMerger.merge({}, request)

    expect(config.json).toBeUndefined()
    expect(Object.keys(config)).toEqual(['url', 'method'])
  })
})
