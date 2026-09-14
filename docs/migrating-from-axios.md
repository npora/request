# Migrating from Axios

Npora Request uses native Fetch values and returns parsed data from its regular
methods. It is not a drop-in replacement for Axios. Migrate one API client at
a time and check response handling, interceptors, and transport behavior in
integration tests. Node.js 22 or newer is required.

## Common request patterns

| Axios | Npora Request | Difference |
| --- | --- | --- |
| `axios.create({ baseURL })` | `createClient({ baseURL })` | Clients own separate defaults and extensions. |
| `(await api.get<User>('/users/1')).data` | `await api.get<User>('/users/1')` | Regular methods return parsed data directly. |
| `await api.get('/users/1')` for status and headers | `await api.getResponse('/users/1')` | `*Response()` returns `data`, `status`, `headers`, and native `raw`. |
| `api.post('/users', payload)` | `api.post('/users', { json: payload })` | The body is a named option. |
| `api.get('/users', { params: { page: 2 } })` | `api.get('/users', { query: { page: 2 } })` | Use `searchParams` when repeated keys or order matter. |
| `{ withCredentials: true }` | `{ fetchOptions: { credentials: 'include' } }` | Fetch controls credential mode. |
| `{ signal, timeout }` | `{ signal, timeout }` | Both options are supported; also review `totalTimeout` when retries are enabled. |

Import the client from the smaller core entrypoint when using individual
plugins:

```ts
import { createClient, isRequestError } from '@npora/request/core'
import { retryPlugin } from '@npora/request/plugins/retry'

interface User {
  id: number
  name: string
}

const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000
}).use(retryPlugin({ retries: 2 }))

const user = await api.get<User>('/users/1', {
  query: { include: 'teams' }
})

const created = await api.post<User>('/users', {
  json: { name: 'Ada' }
})

const response = await api.getResponse<User>('/users/1')
console.log(user, created, response.status)

try {
  await api.get('/users/missing')
} catch (error) {
  if (isRequestError(error)) {
    console.error(error.code, error.status, error.data)
  }
}
```

`get<User>()` is a compile-time assertion, not runtime validation. For data
from an untrusted API, supply `schema` with a Standard Schema compatible
validator. The output type is then inferred and validation failures carry
`SCHEMA_ERROR` metadata. See [response validation](../README.md#response-validation).

## Interceptors and errors

Axios response interceptors receive an Axios response. Npora response
interceptors receive a `NporaResponse`, including its `data`; data-first
methods read `data` after those interceptors complete. Keep the wrapper when
transforming a response:

```ts
api.interceptors.request.use(config => {
  const headers = new Headers(config.headers)
  headers.set('x-app', 'dashboard')
  return { ...config, headers }
})

api.interceptors.response.use(response => ({
  ...response,
  data: typeof response.data === 'string'
    ? response.data.trim()
    : response.data
}))
```

Request, response, and error interceptors are separate managers. Error
interceptors transform the error that is ultimately thrown; returning a value
does not turn a failed request into a success. Use `isRequestError()` to inspect
stable `code`, `status`, and parsed `data`. Installed plugins and interceptors
are scoped to one client; `extend()` inherits configuration and adapter but
does not copy those registrations.

## Retry, cache, and transport

Retry is an explicit plugin and defaults to zero additional attempts until a
`retries` value is set. Cache requires both `cachePlugin()` and
`extensions.cache.enabled: true`, either on a request or in client defaults.
Review replay safety and cache scope before enabling these across an API:

```ts
import { cachePlugin } from '@npora/request/plugins/cache'

const cache = cachePlugin()
const cachedApi = api.extend({
  extensions: { cache: { enabled: true } }
}).use(cache)

await cachedApi.get('/public-catalog')
```

The new `cachedApi` does not inherit `api`'s retry plugin. Install it on that
client too if retries are required. For Node.js proxying, pooling, mutual TLS,
or DNS customization, use a Fetch-compatible Undici wrapper as described in
the [Undici integration guide](undici.md). Browser upload progress uses the
XHR-backed [upload plugin](api.md#upload-progress); Fetch remains the default
transport for regular requests.
