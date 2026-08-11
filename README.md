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
- **Stream without buffering everything.** SSE and NDJSON are exposed as lazy
  async iterables with cancellation, timeout, and response-size enforcement.
- **Add resilience without hiding the transport.** Retry, cache, circuit
  breaker, concurrency, authentication, logging, and progress are isolated,
  composable plugins over the standard Fetch API.
- **Use one predictable contract everywhere.** Browsers, Web Workers, Node.js,
  ESM, and CommonJS share the same typed lifecycle and stable error codes.
- **Ship less supply-chain risk.** The package has no runtime dependencies and
  verifies public exports, browser behavior, security regressions, and size
  budgets before release.

## Features

- Data-first and complete-response APIs with TypeScript inference.
- Object query merging plus native ordered `URLSearchParams` through
  `searchParams`.
- Standard Schema v1 validation and transformation for untrusted responses.
- Incremental SSE and NDJSON async iterables with cancellation and size limits.
- Unified errors across Fetch, XHR, parsing, validation, timeouts, and aborts.
- Request/response/error interceptors with deterministic priority ordering.
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
`GET` and `HEAD` requests cannot contain a body. Invalid configuration throws a
`RequestError` before the adapter sends a request.

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
  dedupe: true
})
```

The default memory store keeps up to 1,000 entries using LRU eviction and
removes expired entries when read. Set `maxEntries` to tune the bound, use `0`
to disable storage, or use `Infinity` for an explicitly unbounded store.

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
import { RequestError } from '@npora/request'

try {
  await api.get('/users/missing')
} catch (error) {
  if (error instanceof RequestError) {
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
- `RESPONSE_TOO_LARGE`
- `CIRCUIT_OPEN`
- `CONCURRENCY_LIMIT`

`SchemaValidationError` extends `RequestError`, so applications can handle all
request failures through the unified base class while still inspecting schema
issues when `error.code === 'SCHEMA_ERROR'`.

## Supply-chain verification

The published package contains only the built `dist` artifacts, has no runtime
dependencies, and is released through npm trusted publishing with provenance.
Repository release gates verify the exact dependency tree against malware
advisories, npm registry signatures, known vulnerabilities, the package file
allowlist, and size budgets.

## Documentation

- [API reference](https://github.com/npora/request/blob/main/docs/api.md)
- [Architecture](https://github.com/npora/request/blob/main/docs/architecture.md)
- [Migration from 0.x](https://github.com/npora/request/blob/main/docs/migration.md)
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
