import { describe, expect, it } from 'vitest'
import { resolveRequestOrigin } from '../src/utils/resolveRequestOrigin'

describe('resolveRequestOrigin', () => {
  it('should resolve absolute, based, and protocol-relative URLs', () => {
    expect(resolveRequestOrigin({
      url: 'https://api.example.com/users'
    })).toBe('https://api.example.com')

    expect(resolveRequestOrigin({
      baseURL: 'https://api.example.com/v1',
      url: '/users'
    })).toBe('https://api.example.com')

    expect(resolveRequestOrigin({
      baseURL: 'https://api.example.com',
      url: '//cdn.example.com/file'
    })).toBe('https://cdn.example.com')
  })

  it('should avoid treating relative colons as an origin', () => {
    expect(resolveRequestOrigin({
      url: '/search?time=10:30'
    })).toBe('default')

    expect(resolveRequestOrigin({
      baseURL: 'https://api.example.com',
      url: '/search?time=10:30'
    })).toBe('https://api.example.com')
  })

  it('should fall back for relative URLs without an absolute base', () => {
    expect(resolveRequestOrigin({
      url: '/users'
    })).toBe('default')

    expect(resolveRequestOrigin({
      baseURL: '/api',
      url: '/users'
    })).toBe('default')
  })
})
