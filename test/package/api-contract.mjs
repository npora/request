import assert from 'node:assert/strict'
import {
  circuitBreakerPlugin,
  createClient,
  MockAdapter,
  RequestError,
  SchemaValidationError
} from '@npora/request'

const requests = []
const adapter = {
  async request(config) {
    requests.push(config)

    return {
      data:
        config.method === 'HEAD'
          ? undefined
          : {
              method: config.method,
              url: config.url
            },
      status: 201,
      statusText: 'Created',
      headers: new Headers({
        'x-contract': 'stable'
      }),
      config,
      raw: new Response(null, {
        status: 201,
        statusText: 'Created',
        headers: {
          'x-contract': 'stable'
        }
      })
    }
  }
}

const client = createClient({
  adapter,
  baseURL: 'https://api.example.com',
  headers: {
    'x-default': 'parent'
  },
  query: {
    locale: 'en',
    page: 1
  },
  extensions: {
    retry: {
      retries: 2,
      delay: 100
    }
  }
})

const data = await client.get('/data')

assert.deepEqual(data, {
  method: 'GET',
  url: '/data'
})

const response = await client.getResponse('/response')

assert.equal(response.status, 201)
assert.equal(response.statusText, 'Created')
assert.equal(response.headers.get('x-contract'), 'stable')
assert.equal(response.raw instanceof Response, true)
assert.deepEqual(response.data, {
  method: 'GET',
  url: '/response'
})

const validated = await client.get('/validated', {
  schema: {
    '~standard': {
      version: 1,
      vendor: 'package-contract',
      validate(value) {
        return {
          value: value.url
        }
      }
    }
  }
})

assert.equal(validated, '/validated')

await assert.rejects(
  client.get('/schema-failure', {
    schema: {
      '~standard': {
        version: 1,
        vendor: 'package-contract',
        validate() {
          return {
            issues: [{ message: 'Rejected by package contract' }]
          }
        }
      }
    }
  }),
  error => (
    error instanceof SchemaValidationError &&
    error instanceof RequestError &&
    error.code === 'SCHEMA_ERROR' &&
    error.issues[0].message === 'Rejected by package contract'
  )
)

const methods = [
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS']
]

for (const [method, expected] of methods) {
  await client[method](`/${method}`)
  assert.equal(requests.at(-1).method, expected)
}

const responseMethods = [
  ['getResponse', 'GET'],
  ['postResponse', 'POST'],
  ['putResponse', 'PUT'],
  ['patchResponse', 'PATCH'],
  ['deleteResponse', 'DELETE'],
  ['headResponse', 'HEAD'],
  ['optionsResponse', 'OPTIONS']
]

for (const [method, expected] of responseMethods) {
  const methodResponse = await client[method](`/${method}`)

  assert.equal(methodResponse.status, 201)
  assert.equal(requests.at(-1).method, expected)
}

await client.request({
  url: '/request',
  method: 'PATCH'
})
assert.equal(requests.at(-1).method, 'PATCH')

const directResponse = await client.requestResponse({
  url: '/request-response',
  method: 'DELETE'
})

assert.equal(directResponse.status, 201)
assert.equal(requests.at(-1).method, 'DELETE')

const child = client.extend({
  baseURL: 'https://child.example.com',
  headers: {
    'x-child': 'true'
  },
  query: {
    page: 2
  },
  extensions: {
    retry: {
      delay: 0
    }
  }
})

await child.get('/child')

const childConfig = requests.at(-1)

assert.equal(childConfig.baseURL, 'https://child.example.com')
assert.deepEqual(childConfig.query, {
  locale: 'en',
  page: 2
})
assert.deepEqual(childConfig.extensions, {
  retry: {
    retries: 2,
    delay: 0
  }
})
assert.equal(
  new Headers(childConfig.headers).get('x-default'),
  'parent'
)
assert.equal(
  new Headers(childConfig.headers).get('x-child'),
  'true'
)

const nativeSearchParams = new URLSearchParams([
  ['tag', 'first'],
  ['tag', 'second']
])

await child.get('/native-query', {
  searchParams: nativeSearchParams
})
nativeSearchParams.append('tag', 'changed-after-request')

const nativeQueryConfig = requests.at(-1)

assert.equal(nativeQueryConfig.query, undefined)
assert.deepEqual([...nativeQueryConfig.searchParams.entries()], [
  ['tag', 'first'],
  ['tag', 'second']
])

let installs = 0
let cleanups = 0
const plugin = {
  name: 'contract',

  install({ interceptors }) {
    installs += 1
    interceptors.request.use(config => {
      const headers = new Headers(config.headers)

      headers.set('x-plugin', 'installed')

      return {
        ...config,
        headers
      }
    })

    return () => {
      cleanups += 1
    }
  }
}

client.use(plugin).use(plugin)

assert.equal(installs, 1)
assert.equal(client.hasPlugin(plugin.name), true)

await client.get('/with-plugin')

assert.equal(
  new Headers(requests.at(-1).headers).get('x-plugin'),
  'installed'
)

const isolatedChild = client.extend()

assert.equal(isolatedChild.hasPlugin(plugin.name), false)

await isolatedChild.get('/isolated-child')

assert.equal(
  new Headers(requests.at(-1).headers).has('x-plugin'),
  false
)

client.unuse(plugin.name)

assert.equal(cleanups, 1)
assert.equal(client.hasPlugin(plugin.name), false)

await client.get('/without-plugin')

assert.equal(
  new Headers(requests.at(-1).headers).has('x-plugin'),
  false
)

const requestCount = requests.length

await assert.rejects(
  client.get('/invalid', {
    timeout: -1
  }),
  error => {
    assert.equal(error instanceof RequestError, true)
    assert.equal(error.name, 'RequestError')
    assert.equal(error.code, 'CONFIG_ERROR')

    return true
  }
)

assert.equal(
  requests.length,
  requestCount,
  'Invalid configuration must fail before the adapter runs.'
)

const mockAdapter = new MockAdapter()

mockAdapter
  .onGet('/mock-contract')
  .replyOnce(503, {
    message: 'busy'
  })
  .onGet('/mock-contract')
  .reply(200, {
    ok: true
  }, {
    headers: {
      'x-mock-contract': 'stable'
    }
  })

const mockClient = createClient({
  adapter: mockAdapter
})

await assert.rejects(
  mockClient.get('/mock-contract'),
  error => {
    assert.equal(error instanceof RequestError, true)
    assert.equal(error.code, 'HTTP_ERROR')
    assert.equal(error.status, 503)

    return true
  }
)

const mockResponse = await mockClient.getResponse('/mock-contract')

assert.deepEqual(mockResponse.data, {
  ok: true
})
assert.equal(mockResponse.headers.get('x-mock-contract'), 'stable')
assert.equal(mockAdapter.history.length, 2)

const breakerAdapter = new MockAdapter()
const breaker = circuitBreakerPlugin({
  failureThreshold: 1
})
const protectedClient = createClient({
  adapter: breakerAdapter
}).use(breaker)

breakerAdapter.onGet('/breaker-contract').reply(503)

await assert.rejects(
  protectedClient.get('/breaker-contract'),
  error => error instanceof RequestError && error.code === 'HTTP_ERROR'
)
await assert.rejects(
  protectedClient.get('/breaker-contract'),
  error => error instanceof RequestError && error.code === 'CIRCUIT_OPEN'
)
assert.equal(breakerAdapter.history.length, 1)
assert.equal(breaker.getState('default'), 'open')

breaker.reset('default')
assert.equal(breaker.getState('default'), 'closed')
