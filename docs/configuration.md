# Configuration Reference

> Complete request configuration for `@npora/request`.

Options can be supplied to `createClient()`, `client.extend()`, or an individual
request. Individual request values take precedence over client defaults.

```ts
const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000
})

await api.get('/users', {
  query: { page: 2 }
})
```

## Core options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `url` | `string` | required | Absolute URL, or a URL resolved against `baseURL`. |
| `method` | `HttpMethod` | `GET` | HTTP method. Method helpers set this automatically. |
| `baseURL` | `string` | none | Base used to resolve relative request URLs. |
| `headers` | `HeadersInit` | none | Request headers. Names merge case-insensitively. |
| `query` | `QueryParams` | none | Object query values appended to the URL. |
| `searchParams` | `URLSearchParams` | none | Native ordered query parameters, including repeated keys. |
| `fetchOptions` | `FetchOptions` | none | Native Fetch options not managed directly by the client. |
| `extensions` | `RequestExtensions` | none | Namespaced configuration owned by installed plugins. |

`query` and `searchParams` are mutually exclusive. Object `query` values may be
strings, numbers, booleans, `null`, `undefined`, or arrays of those values.
`undefined` values are omitted; `null` is serialized as an empty value.

`fetchOptions` accepts native `RequestInit` fields except `method`, `headers`,
`body`, and `signal`, which have dedicated options. Common values include
`credentials`, `cache`, `redirect`, `mode`, `integrity`, `keepalive`,
`referrer`, and `referrerPolicy`.

### XHR transport limitations

Fetch remains the default transport. Upload progress, and download progress
when `downloadPlugin({ transport: 'xhr' })` is selected or required as a
fallback, use `XMLHttpRequest`.

XHR preserves the resolved URL, method, headers, body, cancellation, timeout,
status validation, parsing, retry lifecycle, response hooks, and response
interceptors. It cannot reproduce every Fetch option:

- `credentials: 'include'` maps to `xhr.withCredentials = true`.
- `credentials: 'omit'` cannot guarantee that same-origin cookies are omitted.
- `cache`, `redirect`, `mode`, `integrity`, `keepalive`, `referrer`, and
  `referrerPolicy` have no equivalent mapping and are ignored by XHR.

Use the Fetch download transport when those options are required. Upload
progress currently requires a browser environment with `XMLHttpRequest`.

## Request body

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `body` | `BodyInit \| Record<string, unknown> \| null` | none | Raw Fetch body. Plain objects are JSON encoded. |
| `json` | `Record<string, unknown> \| unknown[]` | none | JSON-encode the value and set an appropriate content type. |
| `form` | `URLSearchParams \| Record<string, QueryValue \| QueryValue[]>` | none | URL-encoded form body. |
| `formData` | `FormData \| Record<string, unknown>` | none | Multipart form body. The runtime supplies the boundary. |
| `maxFormDataDepth` | `number` | `32` | Maximum nested array depth while converting an object to FormData. |

Only one of `body`, `json`, `form`, and `formData` may be present. `GET` and
`HEAD` cannot contain a body. Circular FormData arrays and values deeper than
`maxFormDataDepth` fail before network I/O. Do not set the multipart
`Content-Type` manually because the runtime must add its boundary.

## Cancellation and limits

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `timeout` | `number` | disabled | Abort after this many milliseconds (maximum `2_147_483_647`). `0` disables the timer. |
| `signal` | `AbortSignal` | none | Cancel the request with the platform Abort API. |
| `maxResponseSize` | `number` | `Infinity` | Maximum parsed or streamed response bytes. |

Timeout and external cancellation are composed. Retry delays are also
abortable. `maxResponseSize` failures use `RESPONSE_TOO_LARGE`; set an explicit
limit when responses come from an untrusted service. Streaming SSE and NDJSON
remain bounded while the caller consumes them.

## Response handling

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `responseType` | `ResponseType` | detected | Parse as `json`, `text`, `blob`, `arrayBuffer`, `stream`, `sse`, or `ndjson`. |
| `schema` | `StandardSchemaV1` | none | Validate and optionally transform the parsed value. |
| `validateStatus` | `(status: number) => boolean` | HTTP 2xx | Decide which HTTP statuses resolve successfully. |

When `responseType` is omitted, content type is used to select JSON, text, SSE,
or NDJSON parsing. A Standard Schema failure throws `SchemaValidationError`
with code `SCHEMA_ERROR` and retains the response metadata.

## Extension options

An extension has an effect only after its corresponding plugin is installed.
Plugin defaults and request extension objects are shallow merged.

### `extensions.retry`

Type: `number | RetryOptions`. Requires `retryPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `retries` | `0` | Maximum retry count after the initial attempt. |
| `methods` | `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE` | Replayable methods allowed to retry. |
| `delay` | `0` | Milliseconds or a callback producing the delay. |
| `respectRetryAfter` | `true` | Honor a valid server `Retry-After` value. |
| `maxDelay` | `60000` | Upper bound for retry delay, capped at `2_147_483_647`. |
| `jitter` | `false` | Randomize client-configured retry delays. |
| `maxElapsedTime` | `Infinity` | Total retry time budget, including planned delays. |
| `shouldRetry` | network errors, timeout, HTTP 408/425/429/5xx | Custom retry decision. |
| `onRetry` | none | Observe a scheduled retry; callback errors are isolated. |

`POST` and `PATCH` are not retried unless explicitly added to `methods`.
Readable request streams are never retried because they cannot be replayed.

### `extensions.cache`

Requires `cachePlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` for configured cache methods | Enable caching for this request. |
| `ttl` | `30000` | Cached lifetime in milliseconds. `0` disables persistence. |
| `key` | generated | Override the cache key. |
| `dedupe` | plugin default (`true`) | Share an equivalent in-flight request. |

The plugin caches `GET` and `HEAD` by default. Explicit streaming response
types bypass persistence and in-flight sharing.

### `extensions.circuitBreaker`

Requires `circuitBreakerPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Enable circuit protection. |
| `key` | resolved request origin | Override circuit isolation. |

Open circuits fail with `CIRCUIT_OPEN` before transport I/O.

### `extensions.concurrency`

Requires `concurrencyPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Apply the concurrency limit. |
| `key` | resolved request origin | Override queue isolation. |
| `queueTimeout` | plugin-level value | Maximum time waiting for a permit, capped at `2_147_483_647`. |

Queue overflow and queue timeout fail with `CONCURRENCY_LIMIT`.

### `extensions.auth`

Requires `authPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `token` | plugin token/storage | Override the access token for this request. |
| `scheme` | `Bearer` | Authorization scheme. |

The built-in refresh decision handles HTTP 401. A successful refresh retries
the logical request once, including XHR progress transfers.

### `extensions.logger`

Requires `loggerPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Enable structured lifecycle logging. |
| `logger` | `console` | Override the structured log destination. |
| `createRequestId` | plugin-local counter | Create a correlation identifier. |

Logger callback failures are isolated from the request result.

### `extensions.upload`

Requires `uploadPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `data` | required | `FormData` or an object converted to multipart FormData. |
| `onProgress` | none | Receive transfer totals, byte deltas, rate, and estimated time during browser XHR upload. |

When `onProgress` is omitted, the normal Fetch adapter is used. When it is
present, the request uses XHR inside the normal retry/auth lifecycle. If the
browser cannot determine the total size, `total` and `progress` are omitted.
Throwing from the progress callback aborts the transfer and rejects the
request with the original callback error.

Progress values contain cumulative `loaded` bytes and the `bytes` transferred
since the previous event. After at least 250 milliseconds, `rate` reports the
average bytes per second. `estimated` reports remaining seconds only when both
the total size and rate are available.

### `extensions.download`

Requires `downloadPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `onProgress` | none | Receive transfer totals, byte deltas, rate, and estimated time as bytes arrive. |
| `output` | `blob` | Return a buffered `Blob` or a backpressure-aware `ReadableStream`. |
| `filename` | unused; deprecated | Reserved legacy field. It does not save or rename a file. |

`downloadPlugin()` returns a `Blob`. With progress enabled, `auto` prefers a
Fetch response stream and falls back to XHR; `transport: 'fetch'` and
`transport: 'xhr'` select explicitly. The current Blob result is assembled in
memory, so set `maxResponseSize` for untrusted or potentially large downloads.
If `Content-Length` is unavailable, `total` and `progress` are omitted.
`estimated` is also omitted without a known total. An empty Fetch-stream
download reports one event with `loaded`, `total`, and `bytes` all set to zero.
Throwing from the progress callback cancels or aborts the transfer.

Set `output: 'stream'` for downloads that should not be buffered in memory.
Stream output requires Fetch response-stream support and is incompatible with
`downloadPlugin({ transport: 'xhr' })`; invalid or unavailable combinations
fail with `CONFIG_ERROR` before network I/O. Progress advances as the consumer
reads. Cancelling the returned stream cancels the underlying response reader.
Response-size violations and progress callback failures reject stream reads
because the request promise has already returned the stream.

## Merge and validation rules

- Request values override client defaults.
- Headers merge case-insensitively.
- `query` and `fetchOptions` shallow merge.
- `searchParams` replaces inherited `query` and `searchParams` values.
- Each matching `extensions` object shallow merges.
- A request body mode replaces the inherited body mode.
- Configuration is validated before request hooks and again after they run.
- `ReadableStream` request bodies automatically enable Fetch half-duplex mode.

Invalid URLs, headers, methods, timeouts, sizes, response types, status
validators, body combinations, and query conflicts throw `RequestError` with
code `CONFIG_ERROR` before transport I/O.

See the [API reference](api.md) for client methods, plugin constructor options,
errors, adapters, and extension authoring.
