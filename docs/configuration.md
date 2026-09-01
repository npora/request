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
| `url` | `string \| URL` | required | Relative string, absolute string, or native absolute URL. |
| `method` | `HttpMethod` | `GET` | HTTP method. Method helpers set this automatically. |
| `baseURL` | `string` | none | Base used to resolve relative request URLs. |
| `allowAbsoluteUrls` | `boolean` | `true` | Allow an absolute request URL to bypass `baseURL`. |
| `headers` | `HeadersInit` | none | Request headers. Names merge case-insensitively. |
| `removeHeaders` | `readonly string[]` | `[]` | Case-insensitive inherited header names to remove. |
| `query` | `QueryParams` | none | Object query values appended to the URL. |
| `querySerializer` | `QuerySerializer` | `URLSearchParams` encoding | Serialize object `query` values with a custom wire format. |
| `searchParams` | `URLSearchParams` | none | Native ordered query parameters, including repeated keys. |
| `json` | `unknown` | none | Serialize any JSON value with `stringifyJson` and set the JSON content type. |
| `fetch` | `FetchFunction` | `globalThis.fetch` | Fetch-compatible transport used by `FetchAdapter`; inheritable and overridable per request. |
| `fetchOptions` | `FetchOptions` | none | Native Fetch options not managed directly by the client. |
| `parseJson` | `JsonParser` | `JSON.parse` | Parse buffered JSON responses with request and response context; asynchronous parsers are supported. |
| `stringifyJson` | `JsonStringifier` | `JSON.stringify` | Serialize `json` and plain-object request bodies. |
| `context` | `Record<string, unknown>` | none | Local application metadata available throughout the request lifecycle. |
| `extensions` | `RequestExtensions` | none | Namespaced configuration owned by installed plugins. |

`query` and `searchParams` are mutually exclusive. Object `query` values may be
strings, numbers, booleans, `null`, `undefined`, or arrays of those values.
`undefined` values are omitted; `null` is serialized as an empty value.

Native `URL` values are accepted by `request()`, every method shortcut, and
both response APIs. The client applies a native brand check, so URL values from
another browser realm work while URL-shaped objects are rejected. A URL is
snapshotted to its serialized string before asynchronous interceptors, cache
keys, retries, logging, and adapters observe it; later mutation of the original
object cannot redirect an in-flight request. URL objects are absolute, ignore
`baseURL`, and remain subject to `allowAbsoluteUrls: false`.

`baseURL` uses path-prefix semantics: leading and trailing slashes are
normalized and `/users` remains below a `/v1` prefix. If the base contains
query parameters, they are placed after the combined path and before
request/query options. Base and request query strings retain their order. A
request fragment overrides a base fragment; otherwise the base fragment is
preserved at the end of the final URL. Query-only and fragment-only request
references do not insert an extra path slash.

The `json` shortcut accepts objects, arrays, strings, numbers, booleans, and
`null`. An explicit `json: null` is a real body containing `null`, participates
in body-option conflict checks, and is rejected on GET and HEAD like every
other request body. Values unsupported by native `JSON.stringify`, such as
BigInt, require a custom `stringifyJson` implementation.

Use `querySerializer` when an API requires bracket arrays, comma-separated
values, strict signing order, or another backend-specific format:

```ts
const api = createClient({
  querySerializer(query) {
    return qs.stringify(query, { arrayFormat: 'brackets' })
  }
})
```

The callback applies only to object `query`; native `searchParams` retain their
ordered `URLSearchParams` encoding. A single leading `?` in the returned string
is accepted and removed. Throws and non-string results fail with `CONFIG_ERROR`
before network I/O.

Use `removeHeaders` to remove a case-insensitively matched client default. This
is useful for public endpoints on a client that normally carries authorization:

```ts
await api.get('/public', {
  removeHeaders: ['authorization']
})
```

Set `allowAbsoluteUrls: false` when `baseURL` defines a trusted request
boundary. Absolute and protocol-relative request URLs then fail with a
`CONFIG_ERROR` before adapters run, including URLs introduced by request
interceptors or plugin hooks. Without `baseURL`, absolute URLs remain valid.

`fetchOptions` accepts native `RequestInit` fields except `method`, `headers`,
`body`, and `signal`, which have dedicated options. Common values include
`credentials`, `cache`, `redirect`, `mode`, `integrity`, `keepalive`,
`referrer`, and `referrerPolicy`.

Supply `fetch` when the runtime provides an instrumented or environment-bound
Fetch implementation. It runs through the normal adapter lifecycle, including
timeouts, cancellation, retries, response limits, parsing, and unified errors:

```ts
const api = createClient({
  fetch: tracedFetch
})

await api.get('/health', {
  fetch: isolatedFetch
})
```

The request-level function overrides the client default. Use a custom `Adapter`
only when the transport is not Fetch-compatible.

Node.js applications can inject an Undici Fetch wrapper for ProxyAgent,
connection pooling, mutual TLS, and custom DNS. See the
[Undici integration guide](undici.md).

Use `stringifyJson` for values such as BigInt, dates, or application-specific
wire formats, and `parseJson` for matching decoding or hardened JSON parsers:

```ts
const api = createClient({
  stringifyJson: value => JSON.stringify(value, bigintReplacer),
  parseJson: async (text, { config, response }) => {
    auditJsonResponse(config.url, response.status)
    return secureJsonParse(text)
  }
})
```

The custom parser applies to successful and HTTP-error JSON bodies in both
Fetch and XHR transports, including size-limited responses. It does not alter
SSE or NDJSON streaming parsers. Parser failures remain `PARSER_ERROR`s and
stringifier failures remain `CONFIG_ERROR`s. The second callback parameter
contains the final `RequestConfig` and native `Response`. Its body
has already been buffered, so use the response for metadata such as status,
headers, and URL rather than reading the body again. Existing one-parameter
parsers remain compatible.

Use `context` for trace identifiers, operation names, feature decisions, or
other application metadata needed by interceptors, plugin hooks, custom JSON
parsers, and error handling:

```ts
const api = createClient({
  context: { application: 'dashboard' }
})

await api.get('/users', {
  context: { traceId: currentTraceId }
})
```

Context is shallow merged, so request keys override client defaults and nested
objects are replaced rather than recursively merged. The context container is
copied, but nested values retain their references. It is not passed to Fetch or
XHR, does not vary generated cache keys, and is omitted by the privacy-reduced
`RequestError.toJSON()` representation. It remains available on the in-memory
effective request configuration, including `error.config.context`.

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

Native `FormData`, `Blob`, `ArrayBuffer`, and `ReadableStream` values are
recognized across iframe and window realms using platform brand checks rather
than `instanceof`. This preserves multipart fields, request-size enforcement,
Fetch half-duplex setup, XHR stream rejection, and the no-retry rule for
one-shot streams. Objects that only spoof a native `Symbol.toStringTag` are not
trusted as native bodies.

## Cancellation and limits

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `timeout` | `number` | disabled | Abort after this many milliseconds (maximum `2_147_483_647`). `0` disables the timer. |
| `totalTimeout` | `number` | disabled | Bound the complete lifecycle, including hooks, retries, delays, parsing, interceptors, and stream consumption. |
| `signal` | `AbortSignal` | none | Cancel the request with the platform Abort API. |
| `maxRequestSize` | `number` | `Infinity` | Maximum serialized or streamed request bytes. |
| `maxResponseSize` | `number` | `Infinity` | Maximum parsed or streamed response bytes. |
| `maxErrorResponseSize` | `number` | `10 MiB` | Maximum bytes parsed into a thrown `HTTP_ERROR.data`. |

`timeout` applies independently to each transport attempt. `totalTimeout`
starts when the client call begins and bounds hooks, retries, retry delays,
body parsing, schema validation, response interceptors, and stream consumption.
All timeout and external cancellation signals are composed, and retry delays
are abortable. `maxRequestSize` rejects
oversized JSON, text, URLSearchParams,
Blob, ArrayBuffer, and typed-array bodies with `REQUEST_TOO_LARGE` before the
built-in Fetch or XHR transport sends them. Fetch also counts ReadableStream
chunks without buffering and cancels the source when the limit is exceeded;
the allowed prefix may already have been sent. Native FormData remains
unmeasurable without changing its multipart encoding. Custom adapters must
enforce their own request-body limits. `maxResponseSize`
failures use `RESPONSE_TOO_LARGE`; set an explicit limit when responses come
from an untrusted service. Streaming SSE and NDJSON remain bounded while the
caller consumes them.

`maxErrorResponseSize` is a softer guard for buffered error responses. When a
rejected HTTP response exceeds 10 MiB, the request still fails with
`HTTP_ERROR`, but its `data` is `undefined`; status, headers, configuration,
and native response metadata remain available. Fetch cancels an oversized raw
body, so it cannot subsequently be consumed. XHR has already buffered its Blob
before the status is processed, but skips the potentially larger text/JSON
conversion. Set this option to `Infinity` to restore unlimited error parsing.
An explicit, stricter `maxResponseSize` always takes priority and continues to
fail with `RESPONSE_TOO_LARGE`. The guard is not applied when
`throwHttpErrors: false` makes the response successful.

Error-body reads and asynchronous `parseJson` callbacks are also time-bounded.
An explicit `timeout` remains a hard `TIMEOUT_ERROR`; when per-attempt timeout
is disabled, error-data processing gets a 10-second fallback and then preserves
`HTTP_ERROR` with `data: undefined`. An expiring `totalTimeout` or external
abort always takes priority. Successful responses are unchanged because their
data cannot be silently omitted.

If an error response is malformed for its detected or explicit response type,
or a custom `parseJson` callback rejects it, the request still fails with
`HTTP_ERROR` and `data: undefined`. This soft failure applies only when the
status itself is being rejected. Successful responses and responses accepted
through `throwHttpErrors: false` continue to surface `PARSER_ERROR`, while an
explicit `maxResponseSize` remains a hard `RESPONSE_TOO_LARGE` failure.

Fetch error bodies are consumed directly rather than through `Response.clone()`
so an ignored HTTP error cannot retain an unread stream branch. Treat
`error.data` as the error payload and `error.response.raw` as native response
metadata; its body has already been consumed. Successful complete responses
continue to expose a separately readable raw body.

## Response handling

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `responseType` | `ResponseType` | detected | Parse as `json`, `text`, `blob`, `arrayBuffer`, `bytes`, `formData`, `stream`, `sse`, or `ndjson`. |
| `schema` | `StandardSchemaV1` | none | Validate and optionally transform the parsed value. |
| `itemSchema` | `StandardSchemaV1` | none | Lazily validate and transform each SSE event or NDJSON record. |
| `validateStatus` | `(status: number) => boolean` | HTTP 2xx | Decide which HTTP statuses resolve successfully. |
| `throwHttpErrors` | `boolean` | `true` | Set to `false` to resolve parsed HTTP error responses instead of throwing `HTTP_ERROR`. |

Use `throwHttpErrors: false` when HTTP statuses are part of the endpoint's
normal application protocol and should be inspected through `getResponse()`:

```ts
const response = await api.getResponse('/users/unknown', {
  throwHttpErrors: false
})

if (response.status === 404) {
  // Handle the parsed error response without a catch branch.
}
```

Use `validateStatus` instead for a custom accepted-status range. The two
options are mutually exclusive at the same configuration level. A policy
declared by `extend()` or an individual request replaces the inherited policy,
so a client default can be narrowed without manually clearing it. Network
failures, timeouts, cancellation, parser failures, schema failures, and native
`Response.error()` remain errors. Because a non-throwing HTTP response follows
the successful lifecycle, retry and circuit-breaker plugins do not treat its
status as a failure; cache admission rules still reject non-cacheable statuses.

An explicit `responseType` supplies a matching `Accept` header when the caller
has not already provided one:

| Response type | Generated `Accept` |
| --- | --- |
| `json` | `application/json` |
| `text` | `text/*` |
| `formData` | `multipart/form-data` |
| `sse` | `text/event-stream` |
| `ndjson` | `application/x-ndjson, application/ndjson` |
| `blob`, `arrayBuffer`, `bytes`, `stream` | `*/*` |

Automatic content detection does not guess an `Accept` value, and a JSON
request body sets only `Content-Type`; request and response representations may
differ. Any case-insensitive caller-provided `Accept` value wins. The same
behavior is used by Fetch and the XHR progress transport. Cache keys already
separate response types and vary on custom `Accept`, so negotiated
representations cannot be shared incorrectly.

When `responseType` is omitted, content type is used to select JSON, text, SSE,
or NDJSON parsing. Set `formData` explicitly to parse a multipart or
URL-encoded response with the runtime's native `Response.formData()` support.
Set `bytes` to receive a `Uint8Array`; runtimes without `Response.bytes()` use
an `arrayBuffer()` fallback. Bytes and FormData responses bypass cache
persistence and in-flight sharing because the JSON WebStorage cache cannot
round-trip their native types. A Standard Schema failure throws
`SchemaValidationError` with code `SCHEMA_ERROR` and retains the response
metadata.

Native Fetch `opaque` and `opaqueredirect` responses expose status `0`, no
headers, and no readable body. They resolve by default with `data: undefined`
and remain available as `response.raw`; they are not parsed, cloned, cached, or
shared through in-flight cache deduplication. Requests configured with
`fetchOptions.mode: 'no-cors'` or `fetchOptions.redirect: 'manual'` bypass the
cache before lookup so they cannot collide with readable responses for the
same URL. An explicit `validateStatus` callback still receives status `0` and
may reject it. A custom Fetch implementation that returns `Response.error()`
continues to fail with `HTTP_ERROR` rather than being misclassified as a parser
failure.

## Extension options

An extension has an effect only after its corresponding plugin is installed.
Plugin defaults and request extension objects are shallow merged.

### `extensions.retry`

Type: `number | RetryOptions`. Requires `retryPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `retries` | `0` | Maximum retry count after the initial attempt. |
| `methods` | `GET`, `HEAD`, `OPTIONS`, `QUERY`, `PUT`, `DELETE` | Replayable methods allowed to retry. |
| `statusCodes` | HTTP 408/425/429/5xx and timed 413 | Exact HTTP status codes allowed to retry. |
| `retryOnTimeout` | `true` | Retry per-attempt timeout failures. |
| `delay` | exponential 100–1000 ms | Milliseconds or a callback producing the delay. |
| `respectRetryAfter` | `true` | Honor valid `Retry-After` and common rate-limit reset headers. |
| `maxDelay` | `60000` | Upper bound for retry delay, capped at `2_147_483_647`. |
| `jitter` | `false` | Randomize client-configured retry delays. |
| `maxElapsedTime` | `Infinity` | Total retry time budget, including planned delays. |
| `shouldRetry` | default policy | Override or defer to the default retry decision. |
| `onRetry` | none | Observe a scheduled retry; callback errors are isolated. |

`POST` and `PATCH` are not retried unless explicitly added to `methods`.
Readable request streams are never retried because they cannot be replayed.
An explicit `statusCodes` list replaces the default HTTP status policy but
does not disable network-error retries. HTTP 413 still requires a valid retry
timing header. Set `retryOnTimeout: false` when repeating a timed-out operation
would be unsafe. A custom `shouldRetry` result of `true` or `false` overrides
the built-in decision; return `undefined` to fall back to `statusCodes`,
`retryOnTimeout`, and the network-error policy.
`Retry-After` takes precedence over `RateLimit-Reset`,
`X-RateLimit-Retry-After`, `X-RateLimit-Reset`, and
`X-Rate-Limit-Reset`. Reset values accept delay seconds or current-era Unix
timestamps. Server delays are capped by `maxDelay` and are never jittered.

### `extensions.cache`

Requires `cachePlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` for configured cache methods | Enable caching for this request. |
| `ttl` | `30000` | Cached lifetime in milliseconds. `0` disables persistence. |
| `staleIfError` | response directive or disabled | Maximum stale fallback window in milliseconds. |
| `staleWhileRevalidate` | response directive or disabled | Maximum immediate stale window while refreshing in the background. |
| `key` | generated | Override the cache key. |
| `tags` | `[]` | Associate up to 32 tags with an entry for grouped invalidation. |
| `invalidateTags` | `[]` | Invalidate tags after the request settles successfully. |
| `dedupe` | plugin default (`true`) | Share an equivalent in-flight request. |

The plugin caches `GET` and `HEAD` by default. Explicit streaming response
types bypass persistence and in-flight sharing. Response `max-age` and `Age`
headers may shorten the configured TTL. `no-store`, ambiguous `max-age`, and
`Vary: *` responses are not persisted. Expired and `no-cache` entries with
`ETag` or `Last-Modified` are conditionally revalidated; without a validator,
`no-cache` is not persisted. A `304` response refreshes cached metadata and the
configured lifetime. Equivalent concurrent requests may still share their
network operation.

Because cached entries contain parsed values and generated keys assume stable
query encoding, requests with `parseJson` or `querySerializer` bypass cache
persistence and in-flight sharing unless `extensions.cache.key` is set. An
explicit key declares that the application owns parser and serializer
compatibility for that entry.

The generated key does not serialize request bodies. Body-bearing methods such
as `POST` and `QUERY` therefore bypass persistence and in-flight sharing unless
an explicit key is supplied. That key must distinguish the serialized body and
any representation headers that affect the response.

Request headers also control the plugin. `Cache-Control: no-cache`,
`Cache-Control: max-age=0`, and legacy `Pragma: no-cache` force validation or a
network refresh. `Cache-Control: no-store` bypasses cache reads, writes, and
in-flight deduplication for that request.

Response `Cache-Control: stale-if-error=N` permits an expired entry to be
returned for `N` seconds after an eligible network, timeout, or 5xx failure.
Set `staleIfError` in milliseconds to enable an application policy when the
directive is absent or cap the server window when both are present. Retries run
first. Aborts, parser failures, configuration failures, schema failures, and
non-5xx HTTP errors are never replaced with stale data.

Response `Cache-Control: stale-while-revalidate=N` permits immediate stale
responses for `N` seconds while one background refresh runs through the same
client pipeline. Set `staleWhileRevalidate` in milliseconds to provide an
application window or cap the response directive. Background work is
deduplicated per cache key and stopped by `cache.clear()` or plugin removal.
Explicit request revalidation, `no-cache`, `must-revalidate`, conditional
headers, and range requests take precedence and wait for the network.

Configure `cachePlugin({ onEvent })` to observe cache decisions. The callback
receives only `type` and `timestamp`, and its synchronous or asynchronous
failures are isolated. `cache.getStats()` returns aggregate counters;
`cache.resetStats()` resets the counters without changing cached entries.
Use `cache.set(config, data, options)` to seed parsed response data and
`cache.update(config, updater)` to replace it, delete it by returning
`undefined`, or detect a missing entry from a `false` result. Both methods use
the effective request cache key and serialize with pending same-key storage.
Use `WebStorageCacheStore(storage, { namespace, maxEntries })` for namespaced
`localStorage` or `sessionStorage` persistence of JSON-compatible parsed data.
It provides LRU eviction, scoped clearing and tags, corrupt-record cleanup, and
never serializes native `Response` bodies.
Use `IndexedDBCacheStore(indexedDB, options)` for asynchronous, higher-capacity
persistence with structured-clone support. Its database and namespace are
isolated, tagged operations and clearing stay namespace-scoped, and
`close()` releases the database connection.
Set its positive integer `schemaVersion` and increment it when persisted value
shapes become incompatible. Versions use separate keys; newer clients prune
lower versions, while older version-aware clients preserve higher versions
without interpreting their record structure. Writes, clearing, compaction,
and quota recovery all maintain that forward-compatibility boundary.
Pre-option records are version 1. Keep the namespace stable across schema
upgrades so obsolete records can be removed.
Use `maxBytes` for an approximate structured-clone byte budget in addition to
`maxEntries`. Over-budget records are not persisted and existing records are
evicted by LRU. `quotaRecovery` defaults to `true`, removing the oldest half of
the current schema cache and retrying once after `QuotaExceededError`; recovery
never deletes another namespace or a higher schema version.
Call `getUsage()` for the current schema's aggregate entry count, estimated
bytes, configured limits, and schema version. Set `onEvent` to observe
privacy-safe eviction and rejection summaries. Events contain only `type`,
`reason`, aggregate `entries`, `estimatedBytes`, and `timestamp`; observer
errors are isolated from storage behavior.
Use `shouldPersist(entry, estimatedBytes)` for synchronous or asynchronous
application admission decisions. A `false` result removes an older same-key
record; an exception rejects `set()` without deleting the old record. The
callback receives parsed cache data, so treat it as security-sensitive code.
Use `compact({ expiredBefore, maxRemovals })` for explicit maintenance.
`expiredBefore` defaults to the call time; move it backwards to preserve a
stale-if-error window. `maxRemovals` bounds mutations per transaction and
`hasMore` indicates that another bounded pass may be needed. Usage and
compaction scans use cursors instead of materializing the namespace.
Use `TieredCacheStore({ primary, secondary })` to retain synchronous memory
hits while reading through and writing through to a persistent store. Writes
commit to the secondary tier first; deletion and clearing attempt both tiers.
Both stores must support tags before tiered tag invalidation can be used.
Set `broadcast.channel` to an application-scoped `BroadcastChannel` to evict
other contexts' primary entries after writes and invalidation. Messages contain
only bounded fingerprints and control metadata. `maxTrackedKeys` defaults to
1,000; call `dispose()` to remove the listener.
Set `coordination: { locks: navigator.locks, namespace }` to coalesce same-key
misses and revalidations across same-origin clients. Waiting contexts reread
the shared secondary tier after the current lock holder settles. Use an
application-, account-, and schema-scoped namespace; omit this option when Web
Locks are unavailable. `dedupe: false` disables this coordination.
Call `cache.delete(effectiveRequestConfig)` to remove one generated or custom
cache key. It detaches same-key in-flight work and aborts its background
refresh without disrupting unrelated keys.
Call `cache.invalidateTags(tagOrTags)` to remove entries carrying any supplied
tag. Tags must contain 1–128 characters; duplicates are collapsed. The default
memory store supports this operation, while custom stores must implement the
optional `CacheStore.invalidateTags()` method.
`invalidateTags` can be configured on a mutation without enabling response
caching. It runs once after the final successful response, including after a
successful retry. Final HTTP, Schema, interceptor, or cancellation failures
leave cached entries intact. Asynchronous invalidation finishes before the
successful request promise resolves.

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

### `extensions.rateLimit`

Requires `rateLimitPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Apply the transport-attempt rate limit. |
| `key` | resolved request origin | Override rolling-window isolation. |
| `queueTimeout` | plugin-level value | Maximum time waiting for a permit, capped at `2_147_483_647`. |

Queue overflow and queue timeout fail with `RATE_LIMIT`. Retry attempts consume
permits; cache hits that never enter transport do not.

### `extensions.openTelemetry`

Requires `openTelemetryPlugin()`.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Trace this request's transport attempts. |
| `propagate` | plugin-level value or `true` | Inject the active span context into request headers. |
| `spanName` | HTTP method | Override the low-cardinality span name. |
| `attributes` | `{}` | Add privacy-reviewed attributes for this request. |

Retry attempts receive separate spans and resend counts. Cache hits and earlier
request-admission rejections do not create spans; the first span includes a
later rate-limit wait. URL query strings and exception events are excluded by
default.

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
