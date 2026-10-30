# @npora/request

[![npm version](https://img.shields.io/npm/v/@npora/request.svg)](https://www.npmjs.com/package/@npora/request)
[![CI](https://github.com/npora/request/actions/workflows/ci.yml/badge.svg)](https://github.com/npora/request/actions/workflows/ci.yml)
[![Security](https://github.com/npora/request/actions/workflows/security.yml/badge.svg)](https://github.com/npora/request/actions/workflows/security.yml)
[![runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-success)](package.json)
[![license](https://img.shields.io/npm/l/@npora/request.svg)](LICENSE)

[Website & live playground](https://npora.pages.dev) ·
[API reference](https://github.com/npora/request/blob/main/docs/api.md) ·
[Changelog](https://github.com/npora/request/blob/main/CHANGELOG.md)

A production-focused, TypeScript-first HTTP client built on the standard Fetch
API. It adds typed responses, runtime validation, streaming, stable errors, and
composable resilience while keeping native platform values visible. The package
has zero runtime dependencies.

## Start here

| Goal | Documentation |
| --- | --- |
| Send the first request | [Quick start](#quick-start) |
| Try real requests in the browser | [Live playground](https://npora.pages.dev/#playground) |
| Develop or deploy the website | [Cloudflare Pages guide](https://github.com/npora/request/blob/main/docs/cloudflare-website.md) |
| Move an existing Axios client | [Axios migration guide](https://github.com/npora/request/blob/main/docs/axios-migration.md) |
| Consume SSE or NDJSON | [Streaming responses](#streaming-responses) |
| Run a complete session workflow | [Session example](https://github.com/npora/request/blob/main/docs/workflows.md#build-a-session-client) |
| Refresh authentication tokens | [Authentication workflow](https://github.com/npora/request/blob/main/docs/workflows.md#refresh-authentication-tokens) |
| Find a client or response API | [API reference](https://github.com/npora/request/blob/main/docs/api.md) |
| Configure URLs, bodies, timeouts, or parsing | [Configuration reference](https://github.com/npora/request/blob/main/docs/configuration.md) |
| Add retry, cache, authentication, or observability | [Plugins](#plugins) |
| Handle stable error codes | [Errors](#errors) |
| Configure Node.js proxying, pooling, mTLS, or DNS | [Undici integration](https://github.com/npora/request/blob/main/docs/undici.md) |
| Review runtime boundaries and release checks | [Runtime support](https://github.com/npora/request/blob/main/docs/runtimes.md), [testing](https://github.com/npora/request/blob/main/docs/testing.md), and [security](https://github.com/npora/request/blob/main/docs/security.md) |

## Live playground

Try the library at **[npora.pages.dev](https://npora.pages.dev/#playground)**.
The console uses the request client built from this repository and makes real
same-origin requests to Cloudflare Pages Functions. Its displayed version comes
from the package manifest.

| Scenario | What to observe |
| --- | --- |
| JSON requests | A complete user object returned by `GET`. |
| Runtime validation | Invalid fields rejected with `SCHEMA_ERROR` and field-level issues. |
| Content-bearing queries | An actual HTTP `QUERY` request carrying nested JSON filters. |
| SSE | Three events consumed incrementally, with connection state and cancellation. |
| NDJSON | Records parsed and validated one at a time. |
| Retry | Two `503` responses followed by a successful third attempt. |
| Timeout and circuit breaking | `TIMEOUT_ERROR`, then `CIRCUIT_OPEN` without another network request. |
| Transfer progress | A one-MiB upload in acknowledged 64-KiB parts and a paced one-MiB download. |
| Authentication | Two expired-token requests sharing one refresh before replay. |
| Traffic control | Actual IP-limit observations, a labelled `429` recovery probe, queueing and local `RATE_LIMIT`. |

Failures are deliberately generated for these demonstrations. The upload
splitting is application code composed with the upload plugin. Real IP limits
use server arrival times; a separate, clearly labelled probe makes
`Retry-After` recovery observable even when a slow connection never exceeds
the real limit. Mock users and tokens are demonstration data.

The website and its build tools are separate from the npm package. Installing
`@npora/request` adds no runtime dependencies or website server code. See the
[Cloudflare deployment guide](https://github.com/npora/request/blob/main/docs/cloudflare-website.md)
for local setup, API routes and bindings.

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

Data-first methods return the parsed response body. The `User` generic gives
TypeScript a type; it does **not** check the server response at runtime. For
untrusted data, pass a [Standard Schema](#response-validation) validator:

```ts
import { z } from 'zod'

const userSchema = z.object({
  id: z.number(),
  name: z.string()
})

const validatedUser = await api.get('/users/1', {
  schema: userSchema
}) // inferred from the schema and checked at runtime
```

Request JSON with the dedicated `json` option:

```ts
const created = await api.post<User>('/users', {
  json: {
    name: 'Ada'
  }
})
```

Use a response method when status, headers, or the native `Response` is needed:

```ts
const response = await api.getResponse<User>('/users/1')

console.log(response.data)
console.log(response.status)
console.log(response.headers)
console.log(response.raw)
```

## Why Npora Request

- **Runtime-safe responses.** Standard Schema v1 validates and transforms
  untrusted data while preserving response and error metadata.
- **Incremental streaming.** File downloads, SSE, and NDJSON preserve
  backpressure, cancellation, timeouts, progress, and response-size limits.
- **Composable resilience.** Retry, cache, circuit breaker, concurrency,
  rate limiting, authentication, logging, and observability are isolated
  plugins over the standard Fetch lifecycle.
- **Native platform contracts.** `URL`, `Request`, `Headers`, `FormData`,
  `Blob`, `ArrayBuffer`, and `ReadableStream` retain their Fetch semantics.
- **Bounded traffic and stable failures.** Separate request, successful
  response, and error response limits use typed errors with documented codes.
- **Portable, verifiable delivery.** Browser, Web Worker, Node.js, ESM, and
  CommonJS behavior is checked alongside public exports, security regressions,
  and package-size budgets.

## Version support

| Version | Status | Guidance |
| --- | --- | --- |
| `latest` | Current stable 1.x | Recommended for new and existing applications. |
| Earlier releases `>=1.0.0` | Historical | Upgrade to `latest` for current fixes and security hardening. |
| `<1.0.0` | Unsupported | Upgrade immediately; 0.x receives no fixes or security updates. |

The current 1.x line is in active maintenance. Backward-compatible fixes ship
as patch releases; new public capabilities require a minor release, and
breaking public API changes require a new major version. All published releases
before `1.0.0` are deprecated.

## Native Fetch inputs

Use a native `Request` directly when another platform layer already owns the
request construction. Client defaults and explicit overrides still participate
in the normal lifecycle, while an unchanged body is not cloned or buffered:

```ts
const input = new Request('https://api.example.com/users/1', {
  headers: {
    authorization: `Bearer ${accessToken}`
  }
})

const user = await api.request<User>(input, {
  timeout: 3000
})
```

Native `URL`, `Headers`, body values, cancellation signals, and Fetch options
remain available throughout interceptors, plugins, responses, and errors.

## Content-bearing queries

Use the standardized `QUERY` method for safe, idempotent queries whose input
belongs in a typed request body instead of a long URL:

```ts
const users = await api.query<User[]>('/users/search', {
  json: {
    status: 'active',
    teams: ['platform', 'web']
  }
})
```

JSON supplies the required media type automatically. Replayable QUERY bodies
participate in safe retries when the retry plugin is installed.

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

// Opt in to bounded reconnection after a stream ends or disconnects.
const liveEvents = await api.sse('/events', {
  reconnect: { maxAttempts: 5, delay: 1000, maxDelay: 30000 },
  onStateChange: state => console.log(state)
})

for await (const event of liveEvents) {
  console.log(event.data)
}

const records = await api.ndjson('/users/export', {
  itemSchema: userSchema
})

for await (const user of records) {
  console.log(user.name)
}
```

Iteration is lazy and does not buffer the complete response. Breaking out of
the loop cancels the response reader. `maxResponseSize` remains enforced while
the stream is consumed. `itemSchema` validates and may transform each item
immediately before it is yielded, without buffering the rest of the stream.
Failures expose the item index and NDJSON line or SSE event metadata.
When SSE reconnection is enabled, the next connection sends the last observed
event ID in `Last-Event-ID` and honors the server's `retry` delay up to
`maxDelay`. Cancellation, schema errors, and response-size errors stop the
iterator; each connection uses its own request timeout.

`onStateChange` observes `connecting`, `open`, `reconnecting`, `closed`, and
`errored`. It is available before the initial promise resolves; callback
failures are isolated. See the [streaming workflow](https://github.com/npora/request/blob/main/docs/workflows.md#consume-streaming-responses)
for terminal-state and cancellation details.

Run `pnpm example:streaming` for a local demonstration. See
[streaming workflows](https://github.com/npora/request/blob/main/docs/workflows.md#consume-streaming-responses) for
consumption and error-handling contracts.

Native `FormData`, `Blob`, `ArrayBuffer`, and `ReadableStream` request bodies
also work when created by another same-origin window or iframe. Detection does
not lock streams, and retry safety and request-size limits remain active.
With Fetch, `maxRequestSize` counts stream chunks without buffering and
cancels the source once the limit is exceeded.

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
errors. Fetch consumes error bodies once; use `error.data` for their payload.

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
api.request(nativeRequest, config)
api.requestResponse(nativeRequest, config)

api.get(url, config)
api.post(url, config)
api.put(url, config)
api.patch(url, config)
api.query(url, config)
api.delete(url, config)
api.head(url, config)
api.options(url, config)
api.sse(url, config)
api.ndjson(url, config)

api.getResponse(url, config)
api.postResponse(url, config)
api.putResponse(url, config)
api.patchResponse(url, config)
api.queryResponse(url, config)
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

Retry is opt-in: installing `retryPlugin()` without a `retries` value leaves
the default at zero. Cache is also opt-in per request, or through a client
default under `extensions.cache`. See the
[configuration reference](https://github.com/npora/request/blob/main/docs/configuration.md#extension-options) for the
precise defaults and method rules.

For a smaller memory-only cache, import `memoryCachePlugin` from
`@npora/request/plugins/memory-cache` and enable `extensions.memoryCache`.
It stores successful `GET` and `HEAD` responses with a TTL and bounded LRU
capacity. Set `fetchOptions.credentials: 'omit'` for requests without implicit
credentials; requests with credentials need an explicit, correctly scoped
`memoryCache.key`. See the [runnable example](examples/memory-cache.ts).

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
  rateLimitPlugin,
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
  .use(rateLimitPlugin({ maxRequests: 100, interval: 1000 }))
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

See [cache workflows](https://github.com/npora/request/blob/main/docs/cache.md) for request sharing, cache updates, tag
invalidation, HTTP revalidation, stale recovery, persistent stores, and
coordination across browser tabs.

Built-in plugins:

- `retryPlugin()`
- `cachePlugin()`
- `memoryCachePlugin()`
- `circuitBreakerPlugin()`
- `concurrencyPlugin()`
- `rateLimitPlugin()`
- `openTelemetryPlugin()`
- `openTelemetryMetricsPlugin()`
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

Limit actual transport attempts over a rolling time window independently from
the number of active logical requests:

```ts
const limiter = rateLimitPlugin({
  maxRequests: 100,
  interval: 1000,
  maxQueue: 500,
  queueTimeout: 5000,
  sharedRetryAfter: true,
  maxRetryAfter: 60000
})

const request = createClient().use(limiter)
```

Retry attempts consume permits, while cache hits do not. Full queues and
expired waits reject with the stable `RATE_LIMIT` error code. A 429 response
with `Retry-After` pauses the shared origin queue, so concurrent callers do not
independently retry into the same overloaded upstream.

Trace actual transport attempts without adding an OpenTelemetry runtime
dependency to this package:

```ts
import { context, propagation, trace } from '@opentelemetry/api'

const request = createClient().use(openTelemetryPlugin({
  tracer: trace.getTracer('@npora/request'),
  context,
  trace,
  propagation
}))
```

Each retry receives its own CLIENT span and propagated trace context. Cache
hits do not create transport spans. URLs omit credentials, query strings, and
fragments by default, and exception events are opt-in.

Record low-cardinality OpenTelemetry metrics through a separate optional
plugin:

```ts
import { metrics } from '@opentelemetry/api'

const request = createClient().use(openTelemetryMetricsPlugin({
  meter: metrics.getMeter('@npora/request'),
  semconv: 'both',
  attributes: { 'service.namespace': 'checkout' }
}))
```

The 1.x default, `semconv: 'npora'`, preserves existing dashboards for request
duration, active requests, retries, cache hit/miss, rate-limit waits, and
complete ReadableStream/NDJSON/SSE consumption duration. Use `stable` for the
OpenTelemetry `http.client.request.duration` metric, or `both` while migrating.
Stable duration is recorded in seconds for every actual transport attempt, so
cache hits and background SWR do not create an HTTP measurement. The plugin
does not bundle an SDK or exporter.

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

`MockAdapter` supports opt-in response recording and replay scripts,
method-aware routes, dynamic or one-time responses,
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
- `RATE_LIMIT`

`SchemaValidationError` extends `RequestError`, so applications can handle all
request failures through the unified base class while still inspecting schema
issues when `error.code === 'SCHEMA_ERROR'`.

Use `isRequestError()` and `isSchemaValidationError()` to narrow unknown errors
across realms and package copies. See [error handling](https://github.com/npora/request/blob/main/docs/errors.md) for
recovery, cancellation, and retry decisions.

## Supply-chain verification

The published package contains only the built `dist` artifacts, has no runtime
dependencies, and is released through npm trusted publishing with provenance.
Repository release gates verify the exact dependency tree against malware
advisories, npm registry signatures, known vulnerabilities, the package file
allowlist, and size budgets.

## Documentation

- [Live playground](https://npora.pages.dev/#playground)
- [Website development and Cloudflare deployment](https://github.com/npora/request/blob/main/docs/cloudflare-website.md)
- [Configuration reference](https://github.com/npora/request/blob/main/docs/configuration.md)
- [API reference](https://github.com/npora/request/blob/main/docs/api.md)
- [Architecture](https://github.com/npora/request/blob/main/docs/architecture.md)
- [Migration from 0.x](https://github.com/npora/request/blob/main/docs/migration.md)
- [Common workflows](https://github.com/npora/request/blob/main/docs/workflows.md)
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

To run the website locally, install its isolated tools and build its public assets:

```sh
npm ci --prefix website --ignore-scripts
pnpm website:build
pnpm website:dev
```

Open `http://127.0.0.1:8787`. The development command starts Pages and its local
state Worker. Website checks are `pnpm test:website` and
`pnpm test:website:browser`; they do not deploy or publish anything.

## Versioning

`@npora/request` follows Semantic Versioning. Exports from every public
entrypoint listed in `package.json.exports`, their TypeScript declarations,
documented behavior, stable error codes, and plugin lifecycle are public API.
Breaking changes require a new major version.

Internal modules outside those public entrypoints are not public API.

## License

MIT © Npora Team
