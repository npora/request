import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cachePlugin,
  createClient,
  RequestError,
  SchemaValidationError,
  type Plugin,
  type StandardSchemaV1
} from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('response schema validation', () => {
  it('should validate and transform response data', async () => {
    stubJsonResponse({
      id: '42',
      name: 'Npora'
    })

    const response = await createClient().getResponse('/user', {
      schema: createUserSchema()
    })

    expect(response.data).toEqual({
      id: 42,
      name: 'Npora'
    })
    expect(response.status).toBe(200)
    expect(response.config.schema?.['~standard'].vendor).toBe('test')
  })

  it('should support asynchronous schema validation', async () => {
    stubJsonResponse({ value: 'validated' })

    const schema: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'async-test',
        async validate(value) {
          await Promise.resolve()

          if (
            typeof value === 'object' &&
            value !== null &&
            'value' in value &&
            typeof value.value === 'string'
          ) {
            return { value: value.value }
          }

          return {
            issues: [{ message: 'Expected a string value' }]
          }
        }
      }
    }

    await expect(
      createClient().get('/async', { schema })
    ).resolves.toBe('validated')
  })

  it('should expose issues and response metadata on validation failure', async () => {
    stubJsonResponse({
      id: 'invalid',
      name: 42
    })

    const error = await createClient()
      .get('/user', { schema: createUserSchema() })
      .catch(reason => reason)

    expect(error).toBeInstanceOf(SchemaValidationError)
    expect(error).toBeInstanceOf(RequestError)
    expect(error).toMatchObject({
      name: 'SchemaValidationError',
      code: 'SCHEMA_ERROR',
      status: 200,
      schemaVendor: 'test',
      data: {
        id: 'invalid',
        name: 42
      },
      issues: [
        {
          message: 'Expected numeric id',
          path: ['id']
        },
        {
          message: 'Expected string name',
          path: [{ key: 'name' }]
        }
      ],
      response: {
        status: 200
      }
    })
  })

  it('should wrap errors thrown by schema validators', async () => {
    stubJsonResponse({ ok: true })
    const cause = new Error('validator crashed')
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'throwing-test',
        validate() {
          throw cause
        }
      }
    }

    await expect(
      createClient().get('/failure', { schema })
    ).rejects.toMatchObject({
      name: 'SchemaValidationError',
      code: 'SCHEMA_ERROR',
      schemaVendor: 'throwing-test',
      issues: [],
      cause
    })
  })

  it('should reject invalid Standard Schema results', async () => {
    stubJsonResponse({ ok: true })
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'invalid-result-test',
        validate() {
          return { issues: undefined } as never
        }
      }
    }

    await expect(
      createClient().get('/invalid-result', { schema })
    ).rejects.toMatchObject({
      name: 'SchemaValidationError',
      code: 'SCHEMA_ERROR',
      schemaVendor: 'invalid-result-test',
      issues: [],
      cause: expect.any(TypeError)
    })
  })

  it('should validate before response interceptors observe data', async () => {
    stubJsonResponse({
      id: '42',
      name: 'Npora'
    })
    const request = createClient()
    const observed: unknown[] = []

    request.interceptors.response.use(response => {
      observed.push(response.data)
      return response
    })

    await request.get('/user', {
      schema: createUserSchema()
    })

    expect(observed).toEqual([
      {
        id: 42,
        name: 'Npora'
      }
    ])
  })

  it('should preserve async response hook, schema, and interceptor order', async () => {
    stubJsonResponse({ stage: 'adapter' })
    const order: string[] = []
    const plugin: Plugin = {
      name: 'async-response-order',
      install({ hooks }) {
        hooks.onResponse(async context => {
          order.push('hook:start')
          await Promise.resolve()
          order.push('hook:end')

          if (context.response) {
            context.response = {
              ...context.response,
              data: { stage: 'hook' }
            }
          }
        })
      }
    }
    const schema: StandardSchemaV1<unknown, { stage: string }> = {
      '~standard': {
        version: 1,
        vendor: 'response-order',
        validate(value) {
          order.push('schema')
          return { value: value as { stage: string } }
        }
      }
    }
    const request = createClient().use(plugin)

    request.interceptors.response.use(response => {
      order.push('interceptor')
      return response
    })

    await expect(request.get('/ordered', { schema })).resolves.toEqual({
      stage: 'hook'
    })
    expect(order).toEqual([
      'hook:start',
      'hook:end',
      'schema',
      'interceptor'
    ])
  })

  it('should cache the original parsed value across request schemas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: '42',
        name: 'Npora'
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)
    const request = createClient()

    request.use(cachePlugin())

    await expect(
      request.get('/cached-user', {
        schema: createUserSchema(),
        extensions: {
          cache: {
            enabled: true
          }
        }
      })
    ).resolves.toEqual({
      id: 42,
      name: 'Npora'
    })

    await expect(
      request.get<{ id: string; name: string }>('/cached-user', {
        extensions: {
          cache: {
            enabled: true
          }
        }
      })
    ).resolves.toEqual({
      id: '42',
      name: 'Npora'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should validate deduplicated consumers with their own schemas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'not-numeric',
        name: 'Npora'
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    vi.stubGlobal('fetch', fetchMock)
    const request = createClient()

    request.use(cachePlugin())
    const cache = {
      enabled: true,
      ttl: 0
    }
    const acceptedSchema: StandardSchemaV1<
      unknown,
      { id: string }
    > = {
      '~standard': {
        version: 1,
        vendor: 'accepting-test',
        validate(value) {
          return {
            value: {
              id: (value as { id: string }).id
            }
          }
        }
      }
    }

    const [rejected, accepted] = await Promise.allSettled([
      request.get('/shared-user', {
        schema: createUserSchema(),
        extensions: { cache }
      }),
      request.get('/shared-user', {
        schema: acceptedSchema,
        extensions: { cache }
      })
    ])

    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'SCHEMA_ERROR',
        schemaVendor: 'test'
      }
    })
    expect(accepted).toEqual({
      status: 'fulfilled',
      value: {
        id: 'not-numeric'
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should reject invalid schema configuration before fetch', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createClient().get('/invalid-schema', {
        schema: {} as StandardSchemaV1
      })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should reject invalid or non-streaming item schema configuration', async () => {
    const fetchMock = vi.fn()
    const validSchema = createUserSchema()

    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().ndjson('/invalid-item-schema', {
      itemSchema: {} as StandardSchemaV1
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request itemSchema must implement Standard Schema v1'
    })
    await expect(createClient().get('/invalid-item-response', {
      responseType: 'json',
      itemSchema: validSchema
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Request itemSchema requires an SSE or NDJSON response'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should preserve HTTP errors without running the success schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unavailable' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: {
            'content-type': 'application/json'
          }
        })
      )
    )
    const validate = vi.fn()
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate
      }
    }

    await expect(
      createClient().get('/unavailable', { schema })
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503,
      data: {
        message: 'Unavailable'
      }
    })
    expect(validate).not.toHaveBeenCalled()
  })
})

function createUserSchema(): StandardSchemaV1<
  unknown,
  { id: number; name: string }
> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const record = value as Record<string, unknown>
        const issues: StandardSchemaV1.Issue[] = []

        if (typeof record?.id !== 'string' || !/^\d+$/.test(record.id)) {
          issues.push({
            message: 'Expected numeric id',
            path: ['id']
          })
        }

        if (typeof record?.name !== 'string') {
          issues.push({
            message: 'Expected string name',
            path: [{ key: 'name' }]
          })
        }

        if (issues.length > 0) {
          return { issues }
        }

        return {
          value: {
            id: Number(record.id),
            name: record.name as string
          }
        }
      }
    }
  }
}

function stubJsonResponse(value: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(value), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    )
  )
}
