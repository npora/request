import { describe, expect, it } from 'vitest'
import { RequestError } from '../src'

describe('RequestError', () => {
  it('should create a unified request error', () => {
    const cause = new Error('original error')

    const error = new RequestError('Request failed', {
      code: 'NETWORK_ERROR',
      cause
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RequestError)
    expect(error.name).toBe('RequestError')
    expect(error.message).toBe('Request failed')
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.status).toBeUndefined()
    expect(error.cause).toBe(cause)
  })

  it('should preserve http status', () => {
    const error = new RequestError('Not Found', {
      code: 'HTTP_ERROR',
      status: 404
    })

    expect(error.code).toBe('HTTP_ERROR')
    expect(error.status).toBe(404)
  })

  it.each([
    'HTTP_ERROR',
    'NETWORK_ERROR',
    'TIMEOUT_ERROR',
    'ABORT_ERROR',
    'PARSER_ERROR'
  ] as const)('should support %s', code => {
    const error = new RequestError('Request failed', {
      code
    })

    expect(error.code).toBe(code)
  })
})
