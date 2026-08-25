import { describe, expect, it } from 'vitest'
import {
  RequestError,
  type NporaResponse,
  type RequestConfig
} from '../src'

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

  it('should preserve response data and request config', () => {
    const config: RequestConfig = {
      url: '/users/1'
    }
    const response: NporaResponse<{ message: string }> = {
      data: {
        message: 'Not Found'
      },
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      config,
      raw: new Response()
    }

    const error = new RequestError('Not Found', {
      code: 'HTTP_ERROR',
      response
    })

    expect(error.status).toBe(404)
    expect(error.data).toEqual({
      message: 'Not Found'
    })
    expect(error.response).toBe(response)
    expect(error.config).toBe(config)
  })

  it.each([
    'CONFIG_ERROR',
    'HTTP_ERROR',
    'NETWORK_ERROR',
    'TIMEOUT_ERROR',
    'ABORT_ERROR',
    'PARSER_ERROR',
    'SCHEMA_ERROR',
    'REQUEST_TOO_LARGE',
    'RESPONSE_TOO_LARGE',
    'CIRCUIT_OPEN',
    'CONCURRENCY_LIMIT'
  ] as const)('should support %s', code => {
    const error = new RequestError('Request failed', {
      code
    })

    expect(error.code).toBe(code)
  })
})
