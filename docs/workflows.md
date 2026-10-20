# Common workflows

Start with `createClient()` and add only the behavior an API needs. Regular
methods return parsed data. Use a `*Response()` method when status, headers, or
the native `Response` matter. Node.js 22 or newer is required.

## Build a session client

Run the [complete session example](../examples/session.ts) without credentials,
an external API, or additional dependencies:

```sh
pnpm example:session
```

The example asserts that an expired credential is refreshed, a transient read
failure is retried, and a later list read uses the cache. A rejected write
preserves the cached list; a successful write invalidates its tag so the next
read loads updated data. It also cancels a pending request and clears session
state on logout. CI runs the example as well as typechecking it.

Create token storage, an auth plugin, and a cache for each session. In a server
application, avoid sharing authenticated clients across users. Keep refresh
requests on a separate client without the auth plugin to avoid recursive
refresh. Install plugins explicitly on clients created with `extend()`:
configuration and the adapter are inherited, but plugins and interceptors are
not. A request option under `extensions` configures an installed plugin; it
does not install one.

When leaving a view, abort its outstanding requests. On logout, settle or
cancel session requests, clear cached data and credentials, remove plugins,
and discard the client. Create a new session client when another user signs in.
Do not reuse a previous user's cache or mutate their token storage in place
while requests remain active.

## Keep account transitions isolated

Run the [session isolation example](../examples/session-isolation.ts):

```sh
node --import tsx examples/session-isolation.ts
```

It exercises two accounts against the same URLs through the real FetchAdapter
with an in-memory Fetch function. Overlapping 401 responses for different
endpoints share one refresh. Cached profiles stay private to each session.
Logging out cancels an active old-session request, clears its cache and token,
and rejects further use; the other account's token and cached profile survive.
The example runs in CI without a server or credentials.

Give each session its own AbortController, client, auth plugin, token storage,
and cache. Combine the session signal with any view/query signal:

```ts
const effectiveSignal = AbortSignal.any([sessionSignal, viewSignal])
await api.get('/profile', { signal: effectiveSignal })
```

A per-call signal replaces an inherited signal. Passing only a view's signal
can therefore bypass a client-default logout signal. Compose both explicitly.
Refresh requests should use the session signal and their own deadline, so one
view can cancel independently while logout still stops session-owned work.
Close the application-facing session facade first, abort requests, wait for its
tracked requests to settle, clear cached data and credentials, and remove its
plugins. Do not hand a discarded client's instance to the next account.

## Use an application query cache

When TanStack Query, SWR, or another application data layer owns server state,
start with Npora's HTTP cache disabled. Keep authentication, transport errors,
runtime validation, and request cancellation in the request layer; keep UI query
identity, subscriptions, refresh policy, and mutation-driven UI invalidation in
the application layer. HTTP cache tags do not invalidate an application's query
entries, and invalidating a UI query does not necessarily invalidate an HTTP TTL
entry. Enabling both needs an explicit invalidation policy for both stores.

Use an account-scoped query identity, such as `['profile', accountId]`, rather
than only the endpoint URL. Include tenant or other representation identity
when needed; never put access tokens into UI query keys. Clear user-specific
query state on logout in addition to disposing the request session. On the
server, isolate both the query state and request client per user/request.

A query function can forward the data layer's signal without adding a framework
dependency to the client:

```ts
import type { Client } from '@npora/request/core'

function profileLoader(api: Client, sessionSignal: AbortSignal) {
  return ({ signal }: { signal: AbortSignal }) => api.get('/profile', {
    signal: AbortSignal.any([sessionSignal, signal]),
    extensions: { cache: { enabled: false } }
  })
}
```

Choose which layer owns retries too. If the query layer retries the whole call
and the HTTP plugin retries each attempt, their attempt counts multiply. Set
one retry policy deliberately and use `totalTimeout` to bound each logical HTTP
call. A stream is a live resource rather than a reusable parsed snapshot; own
its reader/iterator in a view or session effect, abort it on teardown, and keep
only derived application data in a query cache.

The isolation example intentionally enables HTTP caching to verify session
boundaries. It is not a framework query-cache configuration or a promise that
cancelling a query automatically clears either cache.

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

If an SSE or NDJSON iterator is no longer needed before the first read, close
it explicitly with `await records[Symbol.asyncIterator]().return?.()`. This also
releases an unopened reconnecting SSE response and its timeout resources.
Closing an iterator does not read an item or start another connection.

The retry plugin handles failures within the request pipeline. It does not
restart an iterator after consumption has begun. For SSE streams that should
resume after EOF or a transient disconnect, opt in to bounded reconnection:

```ts
const events = await api.sse('/events', {
  signal: controller.signal,
  reconnect: { maxAttempts: 5, delay: 1000, maxDelay: 30000 }
})

for await (const event of events) {
  console.log(event.id, event.data)
}
```

The reconnecting iterator sends the latest server `id` as `Last-Event-ID` on
the next connection, including an empty ID that clears an inherited cursor.
A valid server `retry` field replaces `delay` and is capped by `maxDelay`.
Each connection uses its own `timeout` and `totalTimeout`. The initial request
still rejects immediately if it fails; later network, timeout, or stream read
failures may use the remaining reconnect attempts. HTTP status, schema,
cancellation, and size-limit failures stop the iterator. Normal EOF after the last
attempt completes it. HTTP 204 No Content also completes the iterator without
another connection. Applications should still decide how to handle duplicate
events if their server replays an already delivered ID.

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

## Bound a batch of reads

Run the [batch example](../examples/batch.ts) without a network service:

```sh
node --import tsx examples/batch.ts
```

It starts six reads with two active permits and three queue slots. One queued
read is cancelled; another is rejected because the queue is full. A 503 read
retries once while retaining its logical permit, and a 404 remains an item
failure. Successful results and failures keep their input positions. Assertions
verify the maximum active transport count, skipped network calls, and final
empty queue. Source CI and the installed tarball consumer both run this example.

For a modest batch, compose the existing client and plugins:

```ts
import { createClient } from '@npora/request/core'
import { concurrencyPlugin } from '@npora/request/plugins/concurrency'
import { retryPlugin } from '@npora/request/plugins/retry'

const api = createClient({
  baseURL: 'https://api.example.com', timeout: 3000, totalTimeout: 15000
})
  .use(concurrencyPlugin({ maxConcurrent: 4, maxQueue: 20, queueTimeout: 5000 }))
  .use(retryPlugin({ retries: 1, delay: 200, jitter: true }))

const results = await Promise.allSettled(ids.map(id => api.get(`/items/${id}`, {
  signal: batchSignal
})))
```

`Promise.allSettled` observes every failure and returns results in input order;
a failure does not erase successful siblings. `Promise.all` rejects on a failure
but does not cancel the other requests. Use an owning AbortController when the
whole batch should stop. Combine batch/session and per-item signals when both
must remain effective, as in [account transitions](#keep-account-transitions-isolated).
Handle unknown application errors separately from the documented request codes.

| Control | What it bounds | Important boundary |
| --- | --- | --- |
| `concurrencyPlugin` | Active logical requests per isolation key | Retries and their delays keep the original permit; full/expired queues produce `CONCURRENCY_LIMIT`. |
| `rateLimitPlugin` | Actual transport attempts per rolling interval | Retries consume permits; cache hits skip transport; full/expired queues produce `RATE_LIMIT`. |
| Application producer/worker pool | Created tasks and retained application results | Needed for very large batches; HTTP queue bounds do not limit the number of promises you allocate. |

The default isolation key is the resolved origin. Calling multiple upstreams
can therefore use multiple independent limits; use a deliberate shared key if
the application needs a global cap. An Undici connection pool controls sockets,
which is a separate boundary from logical requests or attempts over time.

`timeout` bounds each transport attempt. Use `totalTimeout` to include queue
waits and retry delays in a logical request's budget. Choose queue size and wait
limits deliberately rather than launching a huge array and treating admission
errors as an automatic retry loop. For large imports or exports, read inputs
incrementally and keep only a bounded number of outstanding tasks/results.

Concurrency permits end at the request's settled lifecycle. For SSE/NDJSON or a
native stream, this can occur when the reader/iterable is returned, before body
consumption finishes. To bound open live streams, the application must retain
its own worker slot until iteration ends or the reader is cancelled.

The example uses GET requests. Before applying retries to a batch of writes,
check replayable bodies and server idempotency contracts; a timeout does not
prove a write was not committed. See [failure handling](errors.md).

## Handle failures at the owning boundary

Use the [error-handling guide](errors.md) to distinguish HTTP statuses, schema
failures, cancellation, and local queue admission. Catch stream failures while
iterating, and rethrow unknown application errors. Run the
[offline failure example](../examples/errors.ts) to verify these decisions:

```sh
node --import tsx examples/errors.ts
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
