import { describe, expect, it } from 'vitest'
import {
  isRequestError,
  isSchemaValidationError,
  RequestError,
  SchemaValidationError,
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
    expect(isRequestError(error)).toBe(true)
    expect(isSchemaValidationError(error)).toBe(false)
  })

  it('should recognize branded errors across package instances', () => {
    const foreignRequestError = new Error('foreign request') as Error & {
      code: string
    }

    foreignRequestError.name = 'RequestError'
    foreignRequestError.code = 'NETWORK_ERROR'
    Object.defineProperty(
      foreignRequestError,
      Symbol.for('@npora/request/RequestError'),
      { value: true }
    )

    expect(foreignRequestError).not.toBeInstanceOf(RequestError)
    expect(isRequestError(foreignRequestError)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(
      foreignRequestError,
      Symbol.for('@npora/request/RequestError')
    )?.enumerable).toBe(false)
  })

  it('should recognize schema errors and safely reject unknown values', () => {
    const response = {
      data: undefined,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      config: { url: '/schema' },
      raw: new Response()
    }
    const error = new SchemaValidationError(
      'Invalid response',
      response,
      'test'
    )
    const hostile = new Proxy({}, {
      get() {
        throw new Error('blocked')
      }
    })

    expect(isRequestError(error)).toBe(true)
    expect(isSchemaValidationError(error)).toBe(true)
    expect(isRequestError(null)).toBe(false)
    expect(isRequestError({ code: 'HTTP_ERROR' })).toBe(false)
    expect(isRequestError(hostile)).toBe(false)
    expect(isSchemaValidationError(hostile)).toBe(false)
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

  it('should serialize only privacy-safe error metadata', () => {
    const config: RequestConfig = {
      url: '/users/1',
      headers: {
        authorization: 'Bearer secret'
      },
      json: {
        password: 'secret'
      }
    }
    const cause = new Error('sensitive upstream detail')
    const error = new RequestError('Request failed', {
      code: 'HTTP_ERROR',
      status: 500,
      data: {
        token: 'secret'
      },
      config,
      cause
    })

    expect(error.toJSON()).toEqual({
      name: 'RequestError',
      message: 'Request failed',
      code: 'HTTP_ERROR',
      status: 500
    })
    expect(JSON.stringify(error)).not.toContain('secret')
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
