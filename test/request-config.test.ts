import { describe, expect, it } from 'vitest'
import { createFetchRequest } from '../src'

describe('request config', () => {
  it('should append query params to url', () => {
    const { url } = createFetchRequest({
      url: '/users',
      baseURL: 'https://api.example.com',
      query: {
        page: 1,
        keyword: 'npora',
        active: true,
        empty: null,
        tags: ['ts', 'fetch']
      }
    })

    expect(url).toBe(
      'https://api.example.com/users?page=1&keyword=npora&active=true&tags=ts&tags=fetch'
    )
  })

  it('should create json body and set content-type', async () => {
    const { init } = createFetchRequest({
      url: '/users',
      method: 'POST',
      json: {
        name: 'Npora'
      }
    })

    const headers = init.headers as Headers

    expect(headers.get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ name: 'Npora' }))
  })

  it('should create form body and set content-type', () => {
    const { init } = createFetchRequest({
      url: '/login',
      method: 'POST',
      form: {
        username: 'npora',
        remember: true
      }
    })

    const headers = init.headers as Headers
    const body = init.body as URLSearchParams

    expect(headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8'
    )
    expect(body.toString()).toBe('username=npora&remember=true')
  })

  it('should create formData body without setting content-type', () => {
    const { init } = createFetchRequest({
      url: '/upload',
      method: 'POST',
      formData: {
        name: 'Npora',
        enabled: true
      }
    })

    const headers = init.headers as Headers

    expect(init.body).toBeInstanceOf(FormData)
    expect(headers.has('content-type')).toBe(false)
  })

  it('should keep custom content-type', () => {
    const { init } = createFetchRequest({
      url: '/users',
      method: 'POST',
      headers: {
        'content-type': 'application/custom'
      },
      json: {
        name: 'Npora'
      }
    })

    const headers = init.headers as Headers

    expect(headers.get('content-type')).toBe('application/custom')
  })
})
