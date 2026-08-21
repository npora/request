import { describe, expect, it, vi } from 'vitest'
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

  it('should reuse the last exact successful origin parse', () => {
    const NativeURL = URL
    const URLSpy = vi.fn(function (url: string | URL, base?: string | URL) {
      return new NativeURL(url, base)
    })
    vi.stubGlobal('URL', URLSpy)

    try {
      const config = {
        baseURL: 'https://cache-test.example.com/v1',
        url: '/cached-origin'
      }

      expect(resolveRequestOrigin(config)).toBe('https://cache-test.example.com')
      expect(resolveRequestOrigin(config)).toBe('https://cache-test.example.com')
      expect(URLSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
