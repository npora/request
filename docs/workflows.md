# Common workflows

Start with `createClient()` and add only the behavior an API needs. Regular
methods return parsed data. Use a `*Response()` method when status, headers, or
the native `Response` matter. Node.js 22 or newer is required.

## Read and validate data

Use a TypeScript generic when the response shape is already trusted. A generic
does not check data at runtime. For an external API, pass a Standard Schema
compatible validator such as Zod, Valibot, or ArkType; the output type is
inferred from the schema.

```ts
import { createClient } from '@npora/request/core'
import { z } from 'zod'

const userSchema = z.object({
  id: z.number(),
  name: z.string()
})

const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000
})

const user = await api.get('/users/1', {
  schema: userSchema
})

const response = await api.getResponse('/users/1', {
  schema: userSchema
})

console.log(user.name, response.status, response.headers)
```

The package has no runtime dependency on a schema library. Install the
validator your application uses. Validation failures throw
`SchemaValidationError` with the stable `SCHEMA_ERROR` code, response metadata,
and validation issues. See [response validation](../README.md#response-validation)
for streaming item validation too.

## Send JSON and query parameters

Use `json` for JSON bodies. Use `query` for ordinary query values, or native
`URLSearchParams` when repeated keys and their order matter.

```ts
const created = await api.post('/users', {
  json: { name: 'Ada' }
})

const page = await api.get('/users', {
  query: { page: 2, active: true }
})

const tagged = await api.get('/users', {
  searchParams: new URLSearchParams([
    ['tag', 'typescript'],
    ['tag', 'fetch']
  ])
})
```

`body`, `json`, `form`, and `formData` are mutually exclusive. See the
[configuration reference](configuration.md#request-body) for body and merge
rules.

## Bound retries and handle errors

Retries are opt-in. Install the retry plugin with a nonzero `retries` value;
combine per-attempt `timeout` with `totalTimeout` when the whole operation
needs a deadline. The default retry methods exclude `POST` and `PATCH`.

```ts
import { isRequestError } from '@npora/request/core'
import { retryPlugin } from '@npora/request/plugins/retry'

const reliableApi = createClient({
  baseURL: 'https://api.example.com',
  timeout: 3000,
  totalTimeout: 10000
}).use(retryPlugin({ retries: 2, jitter: true }))

try {
  await reliableApi.get('/users/1')
} catch (error) {
  if (isRequestError(error)) {
    console.error(error.code, error.status, error.data)
  }
}
```

`RequestError` also retains the effective request configuration and the
underlying cause when available. Use its `toJSON()` method for a
privacy-reduced log value. See [error handling](../README.md#errors) and
[retry options](configuration.md#extensionsretry).

## Cache selected reads

Installing `cachePlugin()` alone does not cache requests. Enable caching for
selected `GET` or `HEAD` requests, or set `extensions.cache.enabled` in the
defaults of a client dedicated to cacheable API responses.

```ts
import { cachePlugin } from '@npora/request/plugins/cache'

const cache = cachePlugin()
const catalogApi = createClient({
  baseURL: 'https://api.example.com'
}).use(cache)

const catalog = await catalogApi.get('/catalog', {
  extensions: {
    cache: {
      enabled: true,
      ttl: 30000,
      tags: ['catalog']
    }
  }
})

await cache.invalidateTags('catalog')
```

Equivalent concurrent cache-enabled reads share one network operation by
default. Review [cache options](configuration.md#extensionscache) before
persisting user-specific responses.

## Use native Fetch values

Native `Request`, `Headers`, `URL`, `AbortSignal`, and Fetch options remain
available. An existing `Request` can enter the same client lifecycle, and a
caller can cancel work through its signal:

```ts
const controller = new AbortController()
const input = new Request('https://api.example.com/users/1')

const pending = api.request(input, {
  signal: controller.signal
})

controller.abort()
try {
  await pending
} catch (error) {
  if (isRequestError(error) && error.code === 'ABORT_ERROR') {
    console.log('Request cancelled')
  } else {
    throw error
  }
}
```

Cancellation rejects with `ABORT_ERROR`. For transport configuration on
Node.js, see the [Undici integration guide](undici.md).
