import { describe, expect, it } from 'vitest'
import { createFetchRequest } from '../src'

describe('request config', () => {
  it('should build url with baseURL and query', () => {
    const { url } = createFetchRequest({
      baseURL: 'https://api.example.com',
      url: '/users',
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

  it('should serialize json body', () => {
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

  it('should serialize form body', () => {
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
})
