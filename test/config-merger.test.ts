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
})
