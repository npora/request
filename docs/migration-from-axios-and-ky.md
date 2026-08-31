# Migrating from Axios or Ky

Npora Request keeps Fetch semantics while returning parsed response data by
default. Migration is usually mechanical, but error handling, request bodies,
plugins, and complete responses deserve explicit decisions.

## From Axios

### Create an instance

```ts
// Axios
const api = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 5000
})

// Npora Request
const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000
})
```

### Send JSON and query parameters

Axios accepts the body as the second method argument. Npora Request keeps all
request configuration in one object and uses `json` for JSON serialization:

```ts
// Axios
await api.post('/users', { name: 'Ada' }, {
  params: { notify: true }
})

// Npora Request
await api.post('/users', {
  json: { name: 'Ada' },
  query: { notify: true }
})
```

Use `searchParams` when repeated keys, insertion order, or native URL encoding
must be preserved exactly.

### Read complete responses

Axios always resolves with a response wrapper. Npora Request data methods
resolve with parsed data and response methods expose metadata:

```ts
const data = await api.get<User>('/users/1')
const response = await api.getResponse<User>('/users/1')

console.log(response.data, response.status, response.headers, response.raw)
```

### Replace interceptors and resilience helpers

Application-specific transforms can remain interceptors. Cross-cutting
features should use plugins so ordering, retries, cleanup, and errors share the
same lifecycle:

```ts
const api = createClient()
  .use(retryPlugin({ retries: 2 }))
  .use(circuitBreakerPlugin())
  .use(concurrencyPlugin({ maxConcurrent: 20 }))
```

Axios cancellation tokens should become a native `AbortSignal`. Axios
`transformRequest` and `transformResponse` callbacks usually become request or
response interceptors. JSON-only transformations can use `stringifyJson` and
`parseJson`; the parser's second parameter exposes final request configuration
and response status and headers. Axios currently passes only data to
`transformResponse`; use an Axios response interceptor when equivalent response
metadata is required. Axios `paramsSerializer` maps to `querySerializer`. A
custom transport that preserves the standard Fetch
signature can move to the `fetch` option. Node-specific agents, proxies,
HTTP/2, socket options, or other non-Fetch transport behavior require a custom
adapter because they are not portable Fetch options.

## From Ky

Ky's per-attempt `timeout` and overall `totalTimeout` map directly to the same
Npora Request options. The overall deadline includes hooks, retries, retry
delays, response processing, and stream consumption.

### Parse responses

Ky returns a response promise with body helpers. Npora Request selects a
parser from `responseType` or the response media type and returns the parsed
value:

```ts
// Ky
const user = await ky.get('/users/1').json<User>()

// Npora Request
const user = await api.get<User>('/users/1')
```

Ky's `.formData()` response shortcut maps to an explicit
`responseType: 'formData'`. The same option works through both the Fetch and
XHR transports and honors `maxResponseSize`.

Axios, Ky, and ofetch all accept native Fetch/browser body values. Npora
Request additionally keeps `FormData`, `Blob`, `ArrayBuffer`, and
`ReadableStream` behavior intact when the value was constructed by another
same-origin window or iframe. This matters for micro-frontends and embedded
editors: multipart fields are not rebuilt as an empty form, byte limits remain
enforced, and one-shot streams are not accidentally retried.

Ky's `.bytes()` shortcut maps to `responseType: 'bytes'` and returns a
`Uint8Array` even when the runtime does not yet expose `Response.bytes()`.
Axios and ofetch `arraybuffer` usage can remain `responseType: 'arrayBuffer'`
or move to `bytes` when a typed byte view is more convenient.

[Ky](https://github.com/sindresorhus/ky) limits the body parsed into an
`HTTPError` to 10 MiB. Npora Request matches that safe default through
`maxErrorResponseSize`: oversized error bodies still produce `HTTP_ERROR`,
with `data` left `undefined`. Axios's Node-only
[`maxContentLength`](https://axios-http.com/docs/req_config) is a hard response
limit (`maxBodyLength` separately limits requests); the nearest Npora Request
response equivalent is `maxResponseSize`, which deliberately keeps the
distinct `RESPONSE_TOO_LARGE` classification.
[ofetch](https://github.com/unjs/ofetch) exposes parsed error `data`; callers
migrating endpoints with potentially large failures get the Npora error-only
bound automatically. Set `maxErrorResponseSize: Infinity` only when full error
payloads are trusted and required.

Ky also time-bounds error-data reads and asynchronous JSON parsing. Npora
Request now follows the same failure-safe behavior: `timeout` remains a hard
timeout, while disabling it still gives error-data processing a 10-second
fallback that returns `HTTP_ERROR` without data. This is intentionally stricter
than Axios and ofetch defaults, where timeout is disabled unless configured.
Like Ky, malformed or rejected error data also leaves `data` undefined without
replacing `HTTP_ERROR`. Axios normally ignores automatic JSON parse failures;
Npora keeps strict `PARSER_ERROR` behavior for successful or explicitly
non-throwing responses instead of weakening parsing globally.

Like current Ky, Fetch error bodies are consumed while populating `error.data`
instead of cloning an additional readable stream. `error.response.raw` remains
available for native status and header metadata, but its body is already used.
This avoids retaining an unread `ReadableStream` branch when callers catch and
ignore an HTTP failure.

Explicit response types also negotiate `Accept`, following Ky's body-shortcut
model. Unlike Axios's broad common default, Npora Request does not send an
`Accept` header when response parsing is automatic. Unlike ofetch's JSON-body
default, sending JSON does not assume the server must respond with JSON. Set a
custom `Accept` header whenever an endpoint supports a vendor media type or
multiple representations; caller headers always take precedence.

Use `getResponse()` when native response metadata is needed.

Ky `URL` inputs map directly to Npora Request method arguments or
`RequestConfig.url`. Unlike Axios's string-oriented request configuration,
standard URL values need no manual `.toString()` conversion. Npora Request
snapshots them before asynchronous lifecycle work and preserves its existing
`allowAbsoluteUrls` security boundary.

### Map common options

| Ky | Npora Request |
| --- | --- |
| `prefix` or `baseUrl` | `baseURL` |
| `searchParams` | `query` or native `searchParams` |
| `json` | `json` |
| `timeout` | `timeout` |
| `signal` | `signal` |
| `fetch` | `fetch` |
| `parseJson` | `parseJson` |
| `stringifyJson` | `stringifyJson` |
| `context` | `context` |
| `throwHttpErrors: false` | `throwHttpErrors: false` |
| `hooks.beforeRequest` | request interceptor or plugin request hook |
| `hooks.afterResponse` | response interceptor or plugin response hook |
| `hooks.beforeRetry` | `retryPlugin({ onRetry })` |
| `retry.statusCodes` | `retryPlugin({ statusCodes })` |
| `retry.retryOnTimeout` | `retryPlugin({ retryOnTimeout })` |
| `.json(schema)` | request `schema` |

Npora Request `baseURL` retains Axios/ofetch-style path-prefix behavior. Ky's
current `baseUrl` follows `new URL(input, baseUrl)`, where a leading slash
replaces the base path; remove that slash when migrating if the endpoint should
remain below the configured path prefix. Base query parameters are preserved
and merged safely instead of being left in the middle of the combined URL.

Ky's `throwHttpErrors: false` maps directly. ofetch callers can replace
`ignoreResponseError: true` with the same option. Axios `validateStatus`
continues to map to Npora Request's `validateStatus`; use that callback when
only selected non-2xx statuses should resolve. Npora Request rejects a single
configuration layer that supplies both policies, while a request or extended
client policy cleanly replaces the inherited one.

Like current Ky, Npora Request passes request and response context as the
second `parseJson` argument. Npora Request exposes its final `RequestConfig`
instead of constructing a separate native `Request`, which also keeps the
same callback useful with the XHR transport.

Ky `context` maps directly to the same shallow-merged option. Axios projects
that augment request configuration with tracing or operation fields can move
those fields under `context`, keeping transport configuration and local
metadata separate.

Like Ky, native Fetch `opaque` responses do not become HTTP errors merely
because their hidden status is `0`. Npora Request also handles
`opaqueredirect` as an unreadable successful Fetch result and returns
`data: undefined`; an explicit `validateStatus` callback can reject status `0`
when an application requires it. Opaque-capable requests bypass the cache so a
readable response cannot be substituted for a filtered one with the same URL.

Ky `json` values map directly, including strings, numbers, booleans, and
explicit `null`. Axios callers that previously passed a JSON primitive as
`data` may move it to `json` when automatic JSON content type and custom
`stringifyJson` behavior are desired.

Ky retries by default. Npora Request does not retry unless `retryPlugin()` is
installed and a retry count is configured. This makes network repetition an
explicit application policy. When enabled, server-directed delays recognize
`Retry-After` plus the common `RateLimit-Reset` and `X-RateLimit-*` variants.
Ky and ofetch status-code lists map to `statusCodes`. Unlike Ky's current
default, Npora Request keeps timeout retries enabled unless
`retryOnTimeout: false` is selected, preserving the existing 1.x policy.

## Error handling

Use `isRequestError` and its stable `code` rather than matching messages:

```ts
import { isRequestError } from '@npora/request'

try {
  await api.get('/users/1')
} catch (error) {
  if (isRequestError(error)) {
    console.error(error.code, error.status, error.data)
  }
}
```

This maps Axios's `isAxiosError` and Ky's error type guards while remaining
reliable when more than one package copy or browser realm is involved. Use
`isSchemaValidationError` when schema issues and vendor metadata are needed.

`SchemaValidationError` extends `RequestError`. Timeout, abort, network,
parsing, validation, response-size, concurrency, and circuit failures use
documented stable codes.

## Migration checklist

1. Replace instance defaults and method calls.
2. Move request bodies into `json`, `form`, `formData`, or `body`.
3. Choose data methods or complete-response methods per call site.
4. Replace cancellation tokens with `AbortSignal`.
5. Move resilience behavior into plugins and keep business transforms in
   interceptors.
6. Add Standard Schema validation at untrusted API boundaries.
7. Verify proxy, agent, redirect, cookie, and CORS assumptions in the target
   runtime.
8. Run integration tests against real error bodies, streaming responses, and
   retryable failures before removing the previous client.
