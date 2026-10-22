# Migrate from Axios

Migrate one API module first, keeping its application-facing return type stable.
Npora Request uses Fetch values and its own request contract; it does not accept
Axios configuration unchanged. Node.js 22 or newer is required.

## First request

An Axios data-returning wrapper might look like this:

```ts
const api = axios.create({ baseURL: '/api', timeout: 5000 })
const { data: user } = await api.get<User>('/users/1')
const { data: created } = await api.post<User>('/users', { name: 'Ada' })
```

With Npora Request:

```ts
import { createClient } from '@npora/request/core'

const api = createClient({ baseURL: '/api', timeout: 5000 })
const user = await api.get<User>('/users/1')
const created = await api.post<User>('/users', { json: { name: 'Ada' } })
```

The second method argument is configuration, including for `post`, `put`, and
`patch`. Ordinary methods return parsed data directly. Use
`api.getResponse<User>('/users/1')` when the caller needs `data`, `status`,
`headers`, or the native `raw` Response. Headers are native `Headers`:
read them with `response.headers.get('x-request-id')`.

A generic such as `<User>` does not validate server data. Use an endpoint's
`schema` for runtime validation and inferred output types; see
[response validation](../README.md#response-validation).

## Map configuration deliberately

| Existing Axios usage | Npora Request usage |
| --- | --- |
| `axios.create(defaults)` | `createClient(defaults)` |
| `get(url, { params })` | `get(url, { query })` for flat objects, or `{ searchParams }` for `URLSearchParams` |
| `post(url, data, config)` | `post(url, { ...config, json: data })` for JSON |
| Raw body or multipart payload | `body`, `form`, or `formData`; choose exactly one body option |
| `paramsSerializer` | `querySerializer`; check the resulting wire format |
| `withCredentials: true` | `fetchOptions: { credentials: 'include' }` |
| `response.data` | Direct return value, or `.data` from a `*Response()` method |
| `response.headers['name']` | `response.headers.get('name')` |
| `axios.isAxiosError(error)` | `isRequestError(error)` |
| `error.response?.status` / `.data` | `error.status` / `error.data` after narrowing |
| `signal` | `signal` with `AbortController` |
| CancelToken | Replace with `AbortController`; no CancelToken API |
| Node proxy, agent, or TLS options | Inject a Fetch implementation; see [Undici integration](undici.md) |
| Node `maxRate` (bytes per second) | No built-in bandwidth throttle; enforce it in a transport or a backpressure-aware stream wrapper |

Do not spread an Axios config object into a request. Select supported fields
explicitly, especially body, transport, progress, and authentication settings.
See the [configuration reference](configuration.md) for defaults and limits.

Object `query` supports scalar values and arrays, not nested objects. Undefined
values are omitted and null becomes an empty value. Use `searchParams` when
repeated keys and their order matter, or `querySerializer` for an API-specific
encoding such as bracket arrays. `query` and `searchParams` are mutually exclusive.
Object query defaults merge; explicit `searchParams` replaces inherited query
defaults. Compare the final URL with the old client for affected endpoints.

## Errors, cancellation, and timeouts

```ts
import { isRequestError } from '@npora/request/core'

const controller = new AbortController()

try {
  const user = await api.get<User>('/users/1', {
    signal: controller.signal,
    timeout: 5000,
    totalTimeout: 12000
  })
} catch (error) {
  if (!isRequestError(error)) throw error
  if (error.code === 'ABORT_ERROR') return
  console.error(error.code, error.status, error.data)
}

// Call controller.abort() from the owning view's cleanup or cancel action.
```

`timeout` bounds each transport attempt; `totalTimeout` bounds the complete
lifecycle, including hooks, retry delays, parsing, and stream consumption.
Neither is enabled by default. Both use milliseconds. HTTP status rejection
throws `HTTP_ERROR`; timeout and cancellation use `TIMEOUT_ERROR` and
`ABORT_ERROR`. Parser and schema errors are separate failures. Arbitrary errors
thrown by application interceptors need not be RequestError instances.

For expected statuses, configure `validateStatus` and use a response method:

```ts
const response = await api.getResponse<User>('/users/1', {
  validateStatus: status => status === 404 || (status >= 200 && status < 300)
})
if (response.status === 404) {
  // Handle the missing resource before treating response.data as User.
}
```

## Interceptors and derived clients

Npora Request has separate request, response, and error interceptor managers.
`use()` accepts one interceptor and optional `{ priority }`; it does not accept
Axios's fulfilled/rejected callback pair. Higher priorities run first; equal
priorities preserve registration order. Check ordering when moving an existing
chain. Response interceptors return a response envelope, not just its data:

```ts
api.interceptors.request.use(config => {
  const headers = new Headers(config.headers)
  headers.set('x-app', 'dashboard')
  return { ...config, headers }
})
api.interceptors.response.use(response => {
  console.log(response.status)
  return response
})
api.interceptors.error.use(error => {
  reportError(error)
  return error
})
```

Use the error interceptor to observe or replace an error; returning a value
there does not recover the request as a successful response. Recover in the
caller's `catch` when appropriate.

`api.extend(options)` inherits configuration and the adapter, but does not copy
plugins or interceptors. Install behavior explicitly on each derived client.
In SSR, create authenticated clients per user/request rather than sharing token
state between users.

## Add optional behavior after the basic migration

```ts
import { retryPlugin } from '@npora/request/plugins/retry'

api.use(retryPlugin({ retries: 2, delay: 200, jitter: true }))
```

Retry is opt-in. `retryPlugin()` alone defaults to zero retries. Request options
under `extensions` configure installed plugins; they do not install them. Do
not enable retries for writes without checking method, body replayability, and
server idempotency contracts.

`rateLimitPlugin` limits transport attempts per time window; `concurrencyPlugin`
limits active logical requests. Neither limits upload/download bytes per second
like Axios's Node `maxRate`. Native Fetch does not expose a portable bandwidth
setting. Large-file applications should implement bandwidth policy in their
transport, and keep its cancellation and backpressure behavior covered by tests.

Use the [session workflow](workflows.md#build-a-session-client) for concurrent
auth refresh, cache invalidation, cancellation, and logout. For transfer
callbacks, follow [upload](configuration.md#extensionsupload) and
[download progress](configuration.md#extensionsdownload)
rather than copying Axios callback options. For streaming, use
[async iterable SSE/NDJSON](workflows.md#consume-streaming-responses) or a native
ReadableStream; Node stream consumers need an explicit bridge.

## Verify the migrated module

Run the [offline migration example](../examples/axios-migration.ts):

```sh
pnpm example:axios-migration
```

It uses the real FetchAdapter with an injected in-memory Fetch function and
asserts request URLs, JSON bodies, credentials, response metadata, HTTP errors,
cancellation, interceptor order, and derived-client isolation. It needs no
server, Axios installation, or external credentials. It verifies Npora's side
of the migration; also compare your application's old and new wire requests,
including array encoding, multipart values, credentials, and error handling.

## Compare real HTTP requests

The [migration contract suite](../benchmark/competitors/axios-migration.test.mjs)
compares the built package with pinned Axios 1.20.0 using both its Node HTTP
and Fetch adapters against the same loopback HTTP server:

```sh
npm ci --prefix benchmark/competitors --ignore-scripts
pnpm build
pnpm test:migration:axios
```

The 24 cases cover base paths, scalar query encoding, repeated query keys,
explicit bracket-array serialization, JSON bodies, response metadata,
multipart fields and file contents, HTTP failures, custom status acceptance,
explicit authentication/XSRF headers, URL-encoded forms, default redirects,
manual Fetch redirects, each library's timeout classification,
and cancellation after the server receives a request. CI runs this suite in
its quality job. Comparison dependencies remain in the isolated fixture;
they add no runtime dependency to Npora Request.

Scalar and URLSearchParams cases compare the exact received URL. The bracket
array case compares decoded ordered query entries because Axios and
URLSearchParams escape brackets differently. Multipart compares parsed fields,
file names, media types, and contents; generated boundary strings differ.
The Axios multipart requests explicitly set `headers: { 'Content-Type': null }`
so the transport supplies the boundary, including with the Fetch adapter.
Npora uses `{ body: formData }` without a manually supplied Content-Type.

These checks cover deliberate API mappings, rather than general Axios
compatibility. Browser cookies, CORS, automatic XSRF cookie extraction, proxies,
redirect security policy, timeout equivalence, and interceptor equivalence are
outside this suite. Explicit XSRF headers do not imply automatic cookie support;
Npora does not implement Axios's `auth` option or XSRF cookie-to-header behavior.
Supply authorization deliberately. Axios `maxRedirects` is not a portable Fetch
redirect limit; use Fetch's `redirect` policy and test browser opaque responses
separately. Timeout checks assert the error category, not identical timing scope.
Continue validating application-specific request and response contracts.

For Axios-side options, consult the [official request configuration](https://axios-http.com/docs/req_config).
