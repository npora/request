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
| `allowAbsoluteUrls` | `boolean` | `true` | Allow an absolute request URL to bypass `baseURL`. |
| `headers` | `HeadersInit` | none | Request headers. Names merge case-insensitively. |
| `query` | `QueryParams` | none | Object query values appended to the URL. |
| `searchParams` | `URLSearchParams` | none | Native ordered query parameters, including repeated keys. |
| `fetchOptions` | `FetchOptions` | none | Native Fetch options not managed directly by the client. |
| `extensions` | `RequestExtensions` | none | Namespaced configuration owned by installed plugins. |

`query` and `searchParams` are mutually exclusive. Object `query` values may be
strings, numbers, booleans, `null`, `undefined`, or arrays of those values.
`undefined` values are omitted; `null` is serialized as an empty value.

Set `allowAbsoluteUrls: false` when `baseURL` defines a trusted request
boundary. Absolute and protocol-relative request URLs then fail with a
`CONFIG_ERROR` before adapters run, including URLs introduced by request
interceptors or plugin hooks. Without `baseURL`, absolute URLs remain valid.

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
| `maxRequestSize` | `number` | `Infinity` | Maximum preflightable serialized request bytes. |
| `maxResponseSize` | `number` | `Infinity` | Maximum parsed or streamed response bytes. |

Timeout and external cancellation are composed. Retry delays are also
abortable. `maxRequestSize` rejects oversized JSON, text, URLSearchParams,
Blob, ArrayBuffer, and typed-array bodies with `REQUEST_TOO_LARGE` before the
built-in Fetch or XHR transport sends them. FormData and ReadableStream sizes
cannot be determined without buffering and are not preflighted. Custom
adapters must enforce their own request-body limits. `maxResponseSize`
failures use `RESPONSE_TOO_LARGE`; set an explicit limit when responses come
from an untrusted service. Streaming SSE and NDJSON remain bounded while the
caller consumes them.

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
