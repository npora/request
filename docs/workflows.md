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

## Consume streaming responses

SSE returns event envelopes with string `data`; NDJSON decodes one JSON value
per line. Pass `itemSchema` to validate and infer each yielded item's type.
For SSE, the schema receives the event envelope, including `data`, `event`,
`id`, and optional `retry`; decode application JSON in `data` explicitly or
through a schema transformation.

```ts
import { isRequestError, isSchemaValidationError } from '@npora/request/core'

const controller = new AbortController()

try {
  const records = await api.ndjson('/users/export', {
    itemSchema: userSchema,
    signal: controller.signal,
    totalTimeout: 30000,
    maxResponseSize: 10 * 1024 * 1024
  })

  for await (const user of records) {
    console.log(user.name)
    // Break when enough items have been read, or call controller.abort()
    // from an application cancellation action.
  }
} catch (error) {
  if (isSchemaValidationError(error)) {
    console.error(error.issues, error.itemIndex, error.lineNumber)
  } else if (isRequestError(error) && error.code === 'ABORT_ERROR') {
    console.log('Export cancelled')
  } else {
    throw error
  }
}
```

Catch errors around both the request and the `for await` loop. The request
promise can resolve before a later stream read or item validation fails.
`break` cancels the reader without reporting an abort error; explicit signal
cancellation rejects further consumption with `ABORT_ERROR`. Consume the
stream or cancel it when finished so its reader and timeout resources can
be released. `totalTimeout` includes consumption, and `maxResponseSize`
counts bytes as they are read rather than buffering the whole export.

The retry plugin handles failures within the request pipeline. It does not
restart an iterator after consumption has begun. SSE `id` and `retry` fields
are exposed as event metadata; `sse()` does not automatically reconnect or
send `Last-Event-ID`. Applications that resume a subscription must track their
own cursor and decide how to handle duplicate events and replayable requests.

The [runnable streaming example](../examples/streaming.ts) starts a temporary
localhost server, consumes SSE and NDJSON, verifies cancellation and schema
failure, and shuts the server down. No external service or credentials are
required:

```sh
pnpm example:streaming
```

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

## Refresh authentication tokens

Give each application session its own token storage and auth plugin instance.
When the plugin is configured with `storage`, a returned refresh token is
written once and used by later requests. A fixed `token` option takes priority
over storage, so use storage or a token provider when tokens can change.

```ts
import { createClient, isRequestError } from '@npora/request/core'
import { authPlugin } from '@npora/request/plugins/auth'
import type { AuthTokenStorage } from '@npora/request/plugins/auth'

let accessToken: string | undefined
const tokenStorage: AuthTokenStorage = {
  get: () => accessToken,
  set: token => { accessToken = token },
  remove: () => { accessToken = undefined }
}

const sessionApi = createClient({
  baseURL: 'https://api.example.com',
  totalTimeout: 5000,
  fetchOptions: { credentials: 'include' }
})

const authenticatedApi = sessionApi.extend().use(authPlugin({
  storage: tokenStorage,
  async refreshToken() {
    try {
      const session = await sessionApi.post<{ accessToken: string }>('/session/refresh')
      return session.accessToken
    } catch (error) {
      if (isRequestError(error) && error.status === 401) {
        await tokenStorage.remove()
      }
      throw error
    }
  }
}))

const account = await authenticatedApi.get('/account')
```

Use a separate client without the auth plugin for the refresh endpoint. Give
that request its own deadline; passing an individual caller's cancellation
signal would make it cancel a refresh needed by other callers. The application
owns the refresh-session mechanism and logout policy. The example clears the
access token when the refresh endpoint returns 401; transient network failures
leave credentials intact.

Overlapping 401 handling shares one in-flight refresh within a plugin instance.
Each request can refresh once, then retry with the new token. Cancelling one
waiter rejects that caller with `ABORT_ERROR` while other waiters continue.
If refresh fails, callers retain their original request error and a later
request can try refreshing again. This authentication retry does not require
installing `retryPlugin`.

Create a client and storage per user session on the server; the in-memory
storage above must not be shared across unrelated SSR requests. Browser
applications can retain them for the lifetime of their signed-in session.

Run [the authentication refresh example](../examples/auth-refresh.ts) to verify
shared refresh, independent cancellation, token reuse, and failed-refresh
recovery with in-process native Fetch response fixtures. It needs no network
service or credentials:

```sh
pnpm example:auth-refresh
```

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
