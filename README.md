# @npora/request

[![npm version](https://img.shields.io/npm/v/@npora/request.svg)](https://www.npmjs.com/package/@npora/request)
[![CI](https://github.com/npora/request/actions/workflows/ci.yml/badge.svg)](https://github.com/npora/request/actions/workflows/ci.yml)
[![Security](https://github.com/npora/request/actions/workflows/security.yml/badge.svg)](https://github.com/npora/request/actions/workflows/security.yml)
[![runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-success)](package.json)
[![license](https://img.shields.io/npm/l/@npora/request.svg)](LICENSE)

A production-focused, TypeScript-first HTTP client built on the standard Fetch
API, with zero runtime dependencies.

Npora Request keeps the native Fetch model while adding the contracts and
resilience needed by real applications: inferred response types, runtime
validation, incremental streaming, stable errors, deterministic extension
ordering, retries, caching, concurrency control, circuit breaking,
authentication, and upload/download progress.

## Why Npora Request

- **Trust responses at runtime.** Standard Schema v1 validation checks and can
  transform untrusted data while preserving full response and error metadata.
- **Stream without buffering everything.** File downloads, SSE, and NDJSON can
  be consumed lazily with backpressure, cancellation, timeout, progress, and
  response-size enforcement.
- **Add resilience without hiding the transport.** Retry, cache, circuit
  breaker, concurrency, authentication, logging, and progress are isolated,
  composable plugins over the standard Fetch API.
- **Use one predictable contract everywhere.** Browsers, Web Workers, Node.js,
  ESM, and CommonJS share the same typed lifecycle and stable error codes.
- **Ship less supply-chain risk.** The package has no runtime dependencies and
  verifies public exports, browser behavior, security regressions, and size
  budgets before release.

## Design focus

Npora Request combines runtime validation, incremental streaming, persistent
cache correctness, resilience, observability, and cancellation under one
typed, deterministic lifecycle. It keeps the standard Fetch model, ships with
zero runtime dependencies, supports ESM and CommonJS, and exposes optional
capabilities through tree-shakeable subpath exports.

The current stress gate completed **10,000,000 logical operations at concurrency
256 with zero unexpected failures**, followed by **100,000 real localhost HTTP
requests at concurrency 256**. These are reproducible engineering checks, not
claims about every remote workload; commands and limitations are in the
[benchmark documentation](docs/benchmark.md).

## Features

- Data-first and complete-response APIs with TypeScript inference.
- Native `URL` inputs, including cross-realm values, with stable lifecycle
  snapshots.
- Query- and fragment-safe `baseURL` prefix composition.
- Object query merging plus native ordered `URLSearchParams` through
  `searchParams`.
- Native multipart and URL-encoded response parsing through `formData`.
- Raw binary response parsing as a portable `Uint8Array` through `bytes`.
- Response-type-driven `Accept` negotiation with custom-header precedence.
- Standards-correct opaque and manual-redirect Fetch responses without false
  HTTP or parser failures.
- Optional non-throwing HTTP status handling with parsed response data and
  complete metadata.
- Standard Schema v1 validation and transformation for untrusted responses.
- Incremental SSE and NDJSON async iterables with cancellation and size limits.
- Progress-aware file download streams that preserve backpressure and avoid
  buffering the complete response in memory.
- Unified errors across Fetch, XHR, parsing, validation, timeouts, and aborts.
- Request/response/error interceptors with deterministic priority ordering.
- Shallow-merged local request context for tracing and lifecycle policies.
- Official retry, cache, circuit-breaker, concurrency, authentication, logger,
  upload, and download plugins.
- Method-aware `MockAdapter` routing, matching, delays, failures, and history.
- Browser, Web Worker, ESM, and CommonJS support with zero runtime dependencies.

## Install

```sh
pnpm add @npora/request
```

```sh
npm install @npora/request
```

Node.js 22 or newer is required. Modern Chromium-based browsers, Firefox,
Safari/WebKit, and Web Workers are supported through their native Fetch
implementations.

## Version support

| Version | Status | Guidance |
| --- | --- | --- |
| `latest` | Current | Recommended for all new and existing applications. |
| Earlier releases `>=1.0.0` | Historical stable | Upgrade to `latest` for current fixes and security hardening. |
| `<1.0.0` | Deprecated and unsupported | Upgrade immediately; 0.x receives no fixes or security updates. |

All published releases before `1.0.0` are deprecated by project policy. Do not
use a 0.x release in production, documentation examples, dependency templates,
or new lockfiles.

## Quick start

```ts
import { createClient } from '@npora/request'

interface User {
  id: number
  name: string
}

const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: {
    'x-app': 'dashboard'
  }
})

const user = await api.get<User>('/users/1')
```

Data-first methods return the parsed response body. Use a response method when
status, headers, or the native `Response` is needed:

```ts
const response = await api.getResponse<User>('/users/1')

console.log(response.data)
console.log(response.status)
console.log(response.headers)
console.log(response.raw)
```

## Response validation

Validate untrusted response data with any Standard Schema v1 compatible
library, including Zod 3.24+, Valibot, or ArkType. The schema output type is
inferred automatically and schemas may transform the parsed value:

```ts
import { z } from 'zod'

const userSchema = z.object({
  id: z.number(),
  name: z.string()
})

const user = await api.get('/users/1', {
  schema: userSchema
})

console.log(user.name)
```

Validation failures throw `SchemaValidationError` with the stable
`SCHEMA_ERROR` code, validation issues, schema vendor, parsed response data,
and complete response metadata. Standard Schema support adds no runtime
dependency to Npora Request. Schemas are configured per endpoint so one
endpoint contract cannot be inherited by unrelated requests.

## Streaming responses

SSE and NDJSON responses are decoded incrementally as async iterables. The
client also detects `text/event-stream` and common NDJSON content types
automatically:

```ts
import type { ServerSentEvent } from '@npora/request'

const events = await api.sse('/events')

for await (const event of events) {
  console.log(event.event, event.data, event.id)
}

const records = await api.ndjson<User>('/users/export')

for await (const user of records) {
  console.log(user.name)
}
```

Iteration is lazy and does not buffer the complete response. Breaking out of
the loop cancels the response reader. `maxResponseSize` remains enforced while
the stream is consumed. A response schema validates the parsed response value
once; it does not validate individual SSE events or NDJSON records.

Native `FormData`, `Blob`, `ArrayBuffer`, and `ReadableStream` request bodies
also work when created by another same-origin window or iframe. Detection does
not lock streams, and retry safety and request-size limits remain active.

Buffered bodies attached to thrown HTTP errors are capped at 10 MiB by
default. Override `maxErrorResponseSize`, or set it to `Infinity` for trusted
services that require complete error payloads. This guard preserves
`HTTP_ERROR`; a stricter `maxResponseSize` remains a hard
`RESPONSE_TOO_LARGE` limit.

Error-body reads and asynchronous JSON parsing are also bounded by `timeout`,
or by a 10-second error-only fallback when timeout is disabled. The fallback
keeps `HTTP_ERROR` and omits stalled data; explicit and total timeouts retain
`TIMEOUT_ERROR`. Malformed or rejected error payloads likewise keep
`HTTP_ERROR` with unavailable data, so parser failures cannot hide the server
status. Successful and explicitly non-throwing responses retain strict parser
errors.

## Request configuration

```ts
await api.post('/users', {
  searchParams: new URLSearchParams([
    ['notify', 'true'],
    ['tag', 'typescript'],
    ['tag', 'fetch']
  ]),
  json: {
    name: 'Npora'
  },
  fetchOptions: {
    credentials: 'include'
  }
})
```

Query objects merge with client defaults. Native `searchParams` replace
inherited query defaults while preserving repeated keys and order.

The body options `body`, `json`, `form`, and `formData` are mutually exclusive.
`json` accepts complete JSON root values, including primitives and `null`.
`GET` and `HEAD` requests cannot contain a body. Invalid configuration throws a
`RequestError` before the adapter sends a request.

See the complete [configuration reference](https://github.com/npora/request/blob/main/docs/configuration.md)
for every option, default, merge rule, plugin extension, environment limit,
and transfer-progress behavior.

Create isolated clients with inherited defaults:

```ts
const adminApi = api.extend({
  baseURL: 'https://api.example.com/admin',
  headers: {
    'x-role': 'admin'
  }
})
```

The adapter and configuration are inherited. Plugins and interceptors remain
isolated to each client.

## HTTP methods

```ts
api.request(config)
api.requestResponse(config)

api.get(url, config)
api.post(url, config)
api.put(url, config)
api.patch(url, config)
api.delete(url, config)
api.head(url, config)
api.options(url, config)
api.sse(url, config)
api.ndjson(url, config)

api.getResponse(url, config)
api.postResponse(url, config)
api.putResponse(url, config)
api.patchResponse(url, config)
api.deleteResponse(url, config)
api.headResponse(url, config)
api.optionsResponse(url, config)
api.sseResponse(url, config)
api.ndjsonResponse(url, config)
```

## Plugins

Applications can keep using the backward-compatible root entry, or import
only the client and plugins they need:

```ts
import { createClient } from '@npora/request/core'
import { retryPlugin } from '@npora/request/plugins/retry'

const request = createClient().use(retryPlugin({ retries: 2 }))
```

`MockAdapter` is also available from `@npora/request/testing` and
`@npora/request/adapters/mock` so test-only utilities do not need to be
imported through the production entry point.

```ts
import {
  authPlugin,
  cachePlugin,
  circuitBreakerPlugin,
  concurrencyPlugin,
  createClient,
  retryPlugin
} from '@npora/request'

const cache = cachePlugin()
const request = createClient()
  .use(retryPlugin({
    retries: 2,
    delay: 200,
    jitter: true,
    maxElapsedTime: 10000
  }))
  .use(circuitBreakerPlugin())
  .use(concurrencyPlugin({ maxConcurrent: 20 }))
  .use(cache)
  .use(authPlugin({
    token: () => accessToken,
    refreshToken
  }))

const user = await request.get<User>('/users/1', {
  extensions: {
    cache: {
      enabled: true,
      ttl: 30000
    }
  }
})

cache.clear()
```

Equivalent concurrent cache-enabled requests share one network operation by
default. Pass a custom `CacheStore` to share cached entries across clients or
connect an external storage system:

```ts
const cache = cachePlugin({
  store: sharedStore,
  dedupe: true,
  onEvent(event) {
    metrics.increment(`cache.${event.type}`)
  }
})
```

Use `cache.getStats()` for a snapshot of hits, misses, bypasses,
invalidations, deduplication, revalidation, stale recovery, and background
refresh outcomes.
`cache.resetStats()` resets only these counters; it does not clear entries.
Events contain only a decision type and timestamp, never URLs, cache keys, or
headers. Observer failures do not affect requests.
Failed manual or automatic invalidations are counted in
`invalidationErrors` and emit `invalidation-error` without exposing the error.

Seed or optimistically update parsed cache data without a network request:

```ts
await cache.set({ url: '/users/1' }, user, {
  ttl: 30000,
  tags: ['user:1']
})

await cache.update<User>({ url: '/users/1' }, current => ({
  ...current,
  name: 'Updated locally'
}))
```

Return `undefined` from `update` to delete the entry. It returns `false` when
no entry exists. These operations use the same effective cache key as requests,
wait for overlapping asynchronous store operations, and prevent older
same-key responses from overwriting the new value.

Delete one entry without flushing unrelated cached responses:

```ts
await cache.delete({
  url: '/users/1',
  baseURL: '/api',
  extensions: {
    cache: { enabled: true }
  }
})
```

Pass the effective request configuration used to create the entry, including
merged `baseURL`, query, response type, and representation headers. A custom
`extensions.cache.key` can be deleted without reproducing those dimensions.

Group related entries with bounded cache tags and invalidate them together:

```ts
await request.get('/users/1', {
  extensions: {
    cache: {
      enabled: true,
      tags: ['user:1', 'users']
    }
  }
})

await cache.invalidateTags('user:1')
```

The default memory store supports tags directly. Custom stores must implement
the optional `CacheStore.invalidateTags()` capability.

Persist JSON-compatible cached data across client instances with isolated
browser storage:

```ts
import { WebStorageCacheStore } from '@npora/request/plugins/cache'

const cache = cachePlugin({
  store: new WebStorageCacheStore(sessionStorage, {
    namespace: 'dashboard-v1',
    maxEntries: 250
  })
})
```

Use `localStorage` only when responses may safely survive browser restarts and
sign-out boundaries. The adapter never persists native `Response` objects;
`getResponse()` refetches when raw bytes are required.

For larger values and non-blocking storage, use IndexedDB instead:

```ts
import { IndexedDBCacheStore } from '@npora/request/plugins/cache'

const store = new IndexedDBCacheStore(indexedDB, {
  databaseName: 'dashboard-cache',
  namespace: 'account:1',
  schemaVersion: 2,
  maxEntries: 500,
  maxBytes: 20 * 1024 * 1024,
  shouldPersist: (entry, bytes) => (
    entry.status === 200 && bytes < 2 * 1024 * 1024
  ),
  onEvent: event => metrics.record('persistent-cache', event)
})
const cache = cachePlugin({ store })
```

IndexedDB uses structured cloning, preserving values such as `Blob`, `Date`,
`Map`, typed arrays, and `BigInt` while still omitting native `Response` bodies.
Increment the positive integer `schemaVersion` whenever the cached data shape
becomes incompatible. Older records are isolated and pruned automatically;
the default version `1` continues to read records created before this option
existed. Older clients preserve every higher-version record without validating
its envelope, including during writes, clearing, compaction, and quota
recovery, so rolling deployments remain safe when the persisted structure
changes completely.
`maxBytes` adds an approximate structured-clone byte budget alongside
`maxEntries`. Oversized entries are skipped and older entries are evicted by
LRU. Quota-exceeded writes remove the oldest half of the current schema cache
and retry once by default; set `quotaRecovery: false` to report the first quota
failure without recovery.
Use `await store.getUsage()` to inspect the current schema's aggregate entry
count and estimated bytes. The optional `onEvent` observer reports aggregated
eviction, recovery, cleanup, and oversized-entry rejection events without
exposing keys, namespaces, URLs, or response data. Observer failures never
affect cache operations.
Use `shouldPersist(entry, estimatedBytes)` for application-specific admission,
such as excluding sensitive payloads, one-hit responses, or large low-value
objects. It may return a boolean or promise. Returning `false` removes an older
same-key value and emits an aggregate `admission-policy` rejection; thrown
errors are reported to the caller and leave the old value unchanged.
Run bounded maintenance without loading the namespace into memory:

```ts
const result = await store.compact({
  // Preserve seven days for stale-if-error recovery.
  expiredBefore: Date.now() - 7 * 24 * 60 * 60 * 1000,
  maxRemovals: 500
})
```

`compact()` removes current-schema entries beyond the chosen stale boundary,
reports aggregate scan/removal/byte counts, and emits privacy-safe `expired`
events. Repeat while `hasMore` is true when using `maxRemovals`. Usage
inspection now streams records through an IndexedDB cursor, avoiding a
namespace-sized result array.

Combine memory speed with persistence through a read-through, write-through
store:

```ts
const persistent = new IndexedDBCacheStore(indexedDB, {
  namespace: 'account:1',
  schemaVersion: 2
})
const channel = new BroadcastChannel('dashboard-cache:account:1:v1')
const store = new TieredCacheStore({
  primary: new MemoryCacheStore({ maxEntries: 100 }),
  secondary: persistent,
  broadcast: { channel },
  coordination: {
    locks: navigator.locks,
    namespace: 'dashboard-cache:account:1:v1'
  }
})
const cache = cachePlugin({
  store
})
```

Hot reads remain synchronous. Cold secondary hits are promoted to memory, and
writes reach the persistent tier before becoming visible in memory. The
optional channel evicts stale primary entries in other tabs without sending
URLs, headers, response data, or complete cache keys. Call `store.dispose()`
and `channel.close()` when the context is torn down. Optional Web Locks
coordination serializes same-key refreshes across tabs; waiters reread the
shared secondary cache instead of issuing a duplicate request. Omit
`coordination` where `navigator.locks` is unavailable.
Mutation requests can invalidate tags automatically after their final success:

```ts
await request.patch('/users/1', {
  json: update,
  extensions: {
    cache: {
      invalidateTags: ['user:1', 'users']
    }
  }
})
```

Final HTTP, Schema, interceptor, cancellation, and exhausted-retry failures do
not invalidate entries.

The default memory store keeps up to 1,000 entries using LRU eviction. Expired
entries with `ETag` or `Last-Modified` validators are conditionally revalidated;
set `maxEntries` to tune the bound, use `0` to disable storage, or use `Infinity`
for an explicitly unbounded store.

Request `Cache-Control: no-cache` or `max-age=0` to force validation, and use
`Cache-Control: no-store` to bypass cache reads, writes, and request sharing.
Response `stale-if-error` can serve an expired entry after network, timeout, or
5xx failure; `extensions.cache.staleIfError` sets an application limit in
milliseconds.
Response `stale-while-revalidate` can return stale data immediately while one
deduplicated refresh runs through the same client pipeline in the background.

Built-in plugins:

- `retryPlugin()`
- `cachePlugin()`
- `circuitBreakerPlugin()`
- `concurrencyPlugin()`
- `authPlugin()`
- `loggerPlugin()`
- `uploadPlugin()`
- `downloadPlugin()`

Plugin-owned request options belong under `extensions`. Third-party plugins can
augment `RequestExtensions` through TypeScript module augmentation.

Protect a failing upstream after retries are exhausted:

```ts
const breaker = circuitBreakerPlugin({
  failureThreshold: 5,
  resetTimeout: 30000,
  maxCircuits: 1000
})

const request = createClient()
  .use(retryPlugin({ retries: 2 }))
  .use(breaker)
```

Circuits are isolated by request origin by default. Open circuits reject with
the stable `CIRCUIT_OPEN` error code and permit a bounded half-open probe after
the recovery window. Inactive circuit state is retained with LRU eviction;
active requests are never evicted and can temporarily exceed `maxCircuits`.

Bound concurrent logical requests and queue short bursts before adapter I/O:

```ts
const concurrency = concurrencyPlugin({
  maxConcurrent: 20,
  maxQueue: 200,
  queueTimeout: 5000
})

const request = createClient().use(concurrency)
```

Limits are isolated by resolved request origin. Queued requests are admitted
in FIFO order and remain abortable through their request signal. Full queues
and expired queue waits reject with the stable `CONCURRENCY_LIMIT` error code.

Inject a structured logger when request correlation and timing are needed:

```ts
const request = createClient().use(
  loggerPlugin({
    logger: {
      info(_message, entry) {
        applicationLogger.info(entry)
      },
      error(_message, entry) {
        applicationLogger.error(entry)
      }
    }
  })
)
```

Lifecycle entries include a request identifier and timestamp. Completed
responses include total duration and attempt count; errors include the failed
attempt number. The default logger continues to use `console`.

## Interceptors

```ts
api.interceptors.request.use(config => config)
api.interceptors.response.use(response => response)
api.interceptors.error.use(error => error)
```

An optional numeric priority controls execution order. Higher priorities run
first; equal priorities preserve registration order.

## Request testing

`MockAdapter` supports method-aware routes, dynamic or one-time responses,
query/header matching, delay, timeout and network-error simulation, and request
history:

```ts
const adapter = new MockAdapter()

adapter
  .onGet('/users/1')
  .replyOnce(503, { message: 'busy' })
  .onGet('/users/1')
  .reply(200, { id: 1, name: 'Npora' })

const api = createClient({ adapter })
```

## Errors

```ts
import { isRequestError } from '@npora/request'

try {
  await api.get('/users/missing')
} catch (error) {
  if (isRequestError(error)) {
    console.error(error.code)
    console.error(error.status)
    console.error(error.data)
  }
}
```

Stable request error codes:

- `CONFIG_ERROR`
- `HTTP_ERROR`
- `NETWORK_ERROR`
- `TIMEOUT_ERROR`
- `ABORT_ERROR`
- `PARSER_ERROR`
- `SCHEMA_ERROR`
- `REQUEST_TOO_LARGE`
- `RESPONSE_TOO_LARGE`
- `CIRCUIT_OPEN`
- `CONCURRENCY_LIMIT`

`SchemaValidationError` extends `RequestError`, so applications can handle all
request failures through the unified base class while still inspecting schema
issues when `error.code === 'SCHEMA_ERROR'`.

Prefer `isRequestError()` and `isSchemaValidationError()` when narrowing an
unknown caught value. Their non-enumerable shared brands work across iframes
and duplicated package instances, where `instanceof` can fail.

## Supply-chain verification

The published package contains only the built `dist` artifacts, has no runtime
dependencies, and is released through npm trusted publishing with provenance.
Repository release gates verify the exact dependency tree against malware
advisories, npm registry signatures, known vulnerabilities, the package file
allowlist, and size budgets.

## Documentation

- [Configuration reference](https://github.com/npora/request/blob/main/docs/configuration.md)
- [API reference](https://github.com/npora/request/blob/main/docs/api.md)
- [Architecture](https://github.com/npora/request/blob/main/docs/architecture.md)
- [Migration from 0.x](https://github.com/npora/request/blob/main/docs/migration.md)
- [Migration from Axios or Ky](https://github.com/npora/request/blob/main/docs/migration-from-axios-and-ky.md)
- [Security model](https://github.com/npora/request/blob/main/docs/security.md)
- [Testing and release gates](https://github.com/npora/request/blob/main/docs/testing.md)
- [Performance benchmarks](https://github.com/npora/request/blob/main/docs/benchmark.md)
- [Package size budgets](https://github.com/npora/request/blob/main/docs/package-size.md)
- [Changelog](https://github.com/npora/request/blob/main/CHANGELOG.md)

Project policies:

- [Contributing](https://github.com/npora/request/blob/main/CONTRIBUTING.md)
- [Security reporting](https://github.com/npora/request/blob/main/SECURITY.md)

## Development

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm test:package
pnpm test:browser
```

See the
[testing and release gates](https://github.com/npora/request/blob/main/docs/testing.md)
for the complete matrix.

## Versioning

`@npora/request` follows Semantic Versioning. Package-root exports, their
TypeScript declarations, documented behavior, stable error codes, and plugin
lifecycle are public API. Breaking changes require a new major version.

Internal modules that are not exported from the package root are not public
API.

## License

MIT © Npora Team
