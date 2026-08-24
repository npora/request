# Npora Request API

> Public API contract of Npora Request.

For option types, defaults, merge behavior, runtime support, and plugin-owned
request fields, see the [configuration reference](configuration.md).

---

# Client

## createClient()

```ts
const request = createClient(options)
```

Creates a request client instance.

```ts
const request = createClient({
  baseURL: '/api',
  timeout: 5000
})
```

---

## extend()

```ts
const childRequest = request.extend(options)
```

Creates a new isolated client by merging `options` with the current client's
defaults. The child inherits the adapter unless a replacement is supplied.
Headers, query parameters, native Fetch options and extension configuration use
the same merge rules as individual requests.

```ts
const api = createClient({
  baseURL: '/api',
  headers: {
    'x-app': 'dashboard'
  }
})

const adminApi = api.extend({
  baseURL: '/api/admin',
  headers: {
    'x-role': 'admin'
  }
})
```

Interceptors and installed plugins are instance-scoped and are not copied to
the child client.

---

## request()

```ts
request.request<T>(config): Promise<T>
request.requestResponse<T>(config): Promise<NporaResponse<T>>
```

`request()` returns parsed response data. `requestResponse()` returns the
complete response.

```ts
const user = await request.request<User>({
  url: '/user',
  method: 'GET'
})

const response = await request.requestResponse<User>({
  url: '/user',
  method: 'GET'
})

console.log(response.status)
```

---

## HTTP Methods

```ts
request.get<T>(url, config?)
request.post<T>(url, config?)
request.put<T>(url, config?)
request.patch<T>(url, config?)
request.delete<T>(url, config?)
request.head(url, config?)
request.options<T>(url, config?)
request.sse(url, config?)
request.ndjson<T>(url, config?)

request.getResponse<T>(url, config?)
request.postResponse<T>(url, config?)
request.putResponse<T>(url, config?)
request.patchResponse<T>(url, config?)
request.deleteResponse<T>(url, config?)
request.headResponse(url, config?)
request.optionsResponse<T>(url, config?)
request.sseResponse(url, config?)
request.ndjsonResponse<T>(url, config?)
```

Example:

```ts
const user = await request.get<User>('/user')

const response = await request.getResponse<User>('/user')
console.log(response.headers)
```

`head()` resolves to `undefined` because HEAD responses do not contain a
response body. Use `headResponse()` to inspect status and headers.

---

# Config

## Base

```ts
{
  baseURL?: string
  url: string
  method?: HttpMethod
  fetchOptions?: FetchOptions
  headers?: HeadersInit
  query?: QueryParams
  searchParams?: URLSearchParams
  extensions?: RequestExtensions
}
```

`fetchOptions` passes native Fetch options to the adapter. Npora Request
continues to manage `method`, `headers`, `body` and `signal`.

Object `query` parameters are shallow merged with client defaults. Native
`searchParams` replace inherited query defaults and preserve repeated keys,
entry order and native `URLSearchParams` encoding semantics. `query` and
`searchParams` are mutually exclusive.

```ts
await request.get('/account', {
  fetchOptions: {
    credentials: 'include',
    redirect: 'manual',
    cache: 'no-store'
  }
})
```

---

## Body

```ts
{
  body?: BodyInit | Record<string, unknown> | null
  json?: Record<string, unknown> | unknown[]
  form?: URLSearchParams | Record<string, QueryValue | QueryValue[]>
  formData?: FormData | Record<string, unknown>
  maxFormDataDepth?: number
}
```

Nested FormData arrays are flattened up to `maxFormDataDepth`, which defaults
to 32. Circular arrays and values deeper than the configured limit fail with a
`CONFIG_ERROR` before Fetch or XMLHttpRequest sends data. Use `Infinity` only
when the FormData structure is fully trusted.

---

## Control

```ts
{
  timeout?: number
  signal?: AbortSignal
  maxResponseSize?: number
}
```

Timeout timers and composed abort listeners are released when a request
settles, times out or is externally aborted. `maxResponseSize` limits parsed
and streamed response bytes and defaults to `Infinity`. A response that
exceeds the limit fails with `RESPONSE_TOO_LARGE`; a trustworthy
`Content-Length` can reject it before the body is consumed.

---

## Response

```ts
{
  responseType?:
    | 'json'
    | 'text'
    | 'blob'
    | 'arrayBuffer'
    | 'stream'
    | 'sse'
    | 'ndjson'
  schema?: StandardSchemaV1
  validateStatus?: (status: number) => boolean
}
```

`schema` accepts any Standard Schema v1 compatible validator. It validates the
parsed value for successful responses after plugin response hooks and before
application response interceptors run. This lets transport plugins cache the
original parsed value while every consuming request applies its own schema.
Both synchronous and asynchronous validators are supported, successful schema
transformations replace `response.data`, and the schema output type is inferred
by data-only and complete-response methods.

HEAD, 204, 205, and 304 responses are treated as bodyless. A 304 response still
fails the default status policy with `HTTP_ERROR`, but it does not become a
`PARSER_ERROR` solely because a JSON content type accompanies its empty body.

Schemas are endpoint-specific request configuration and are intentionally not
accepted as client or `extend()` defaults, preventing one endpoint's contract
from being inherited by unrelated requests.

```ts
import { z } from 'zod'

const userSchema = z.object({
  id: z.number(),
  name: z.string()
})

const user = await request.get('/users/1', {
  schema: userSchema
})

const response = await request.getResponse('/users/1', {
  schema: userSchema
})
```

Failed validation throws `SchemaValidationError`, which extends
`RequestError`, uses `SCHEMA_ERROR`, and exposes `issues`, `schemaVendor`, the
parsed data, and response metadata. If the validator throws, its error is
preserved as `cause`. Schemas run only for successful HTTP responses; HTTP
error bodies continue to use `HTTP_ERROR` without invoking the success schema.

The schema validates the parsed response value once. It does not validate each
record inside SSE or NDJSON async iterables. Schema validators are
application-provided code and should be reviewed like interceptors and
plugins.

Data-only methods parse successful Fetch responses directly when no response
hooks or interceptors are installed. Complete response methods, response
lifecycle extensions and HTTP errors preserve a separately readable `raw`
Response for buffered response types. Streaming response types deliberately do
not clone the body because an unread clone could buffer an unbounded stream;
their `raw` response refers to the same body consumed by the async iterable.

`stream` exposes the native `ReadableStream`. `sse` and `ndjson` return lazy
`AsyncIterable` values that decode records without buffering the complete
response. The response content type selects `sse` automatically for
`text/event-stream` and `ndjson` for `application/x-ndjson`,
`application/ndjson`, and structured `+ndjson` types.

```ts
import type { ServerSentEvent } from '@npora/request'

const events = await request.sse('/events')

for await (const event of events) {
  console.log(event.event, event.data, event.id, event.retry)
}

const records = await request.ndjson<User>('/users.ndjson')

for await (const user of records) {
  console.log(user)
}
```

SSE parsing follows the event-stream field rules: repeated `data` fields are
joined with newlines, event identifiers and valid retry delays persist, comment
lines are ignored, and the default event type is `message`. NDJSON ignores
blank lines and reports malformed JSON with its one-based line number.

Breaking out of either iterator cancels the underlying response reader.
Transport interruptions reject the next iterator operation with
`PARSER_ERROR`; request timeouts, external cancellation, and response-size
limits continue to apply while streaming. Long-lived SSE connections should
omit `timeout` unless a total connection lifetime is desired.

The cache plugin bypasses explicit streaming response types. Automatically
detected streaming responses are neither persisted nor shared between
concurrent consumers.

## Config Merge Rules

Client defaults and request configuration are merged deterministically:

- Request values override client defaults.
- Header names are merged case-insensitively.
- `query` and `fetchOptions` are shallow merged; `searchParams` are cloned and
  replace inherited query defaults.
- Each `extensions` entry is shallow merged when both values are objects.
- Supplying a request body mode replaces the default body mode.

The body options `body`, `json`, `form` and `formData` are mutually exclusive.
`GET` and `HEAD` requests cannot include a body. Invalid headers, invalid
timeout values, invalid response types or status validators, unsupported
method/body combinations and body configuration conflicts throw a
`RequestError` with code `CONFIG_ERROR` before any network request is sent.
Configuration is validated again after plugin request hooks, including when a
custom adapter is used.

Native `ReadableStream` request bodies automatically use Fetch half-duplex
mode, as required by Node's Fetch implementation for streaming uploads.

---

# MockAdapter

`MockAdapter` provides deterministic request tests without network I/O.
Method-specific routes return the adapter after a reply is registered, so
different routes can be chained:

```ts
const adapter = new MockAdapter()

adapter
  .onGet('/users/1')
  .reply(200, { id: 1, name: 'Npora' })
  .onPost('/users')
  .reply(201, { id: 2 }, {
    headers: {
      location: '/users/2'
    }
  })

const request = createClient({ adapter })
```

Available method matchers are `onGet`, `onPost`, `onPut`, `onPatch`,
`onDelete`, `onHead`, `onOptions` and generic `onMethod`. URLs may be exact
strings or regular expressions. Object matchers can additionally require an
exact object query or ordered native `searchParams`, and a subset of request
headers:

```ts
adapter.onGet({
  url: /^\/users\/\d+$/,
  query: {
    include: ['profile', 'roles']
  },
  headers: {
    authorization: 'Bearer test-token'
  }
}).reply(config => ({
  status: 200,
  data: {
    requested: config.url
  }
}))
```

Rules use registration order. Register one-time behavior before its persistent
fallback:

```ts
adapter
  .onGet('/unstable')
  .replyOnce(503, { message: 'busy' })
  .onGet('/unstable')
  .reply(200, { ok: true })
```

Mock HTTP statuses follow `validateStatus` and produce the same `HTTP_ERROR`
shape as Fetch responses. Network and timeout failures can be simulated
directly:

```ts
adapter.onGet('/offline').networkError()
adapter.onGet('/slow').timeout()
adapter.onGet('/temporary').networkErrorOnce()
```

Configure a default delay on the adapter or a per-reply delay. Delays respect
the request timeout and abort signal.

```ts
const adapter = new MockAdapter({
  delay: 20
})

adapter.onGet('/slow').reply(200, { ok: true }, {
  delay: 100
})
```

`adapter.history` contains matched and unmatched request configurations.
`resetHistory()` clears only history, `resetHandlers()` clears legacy handlers
and routes, and `reset()` clears both. The legacy `on(url, handler)` API remains
available for URL-only 200 responses.

---

# Interceptors

```ts
request.interceptors.request.use(config => config)

request.interceptors.response.use(response => response)

request.interceptors.error.use(error => error)
```

Interceptors are user-level extension points.

Synchronous interceptors remain on the synchronous lifecycle path. If an
interceptor returns a Promise, the remaining interceptors continue
asynchronously in the same deterministic order.

Errors thrown by request or response interceptors follow the same error
lifecycle as adapter failures. Plugin error hooks run before user error
interceptors. Failures in request, error or retry hooks are also forwarded to
the final error interceptor.

An optional priority controls execution order. Higher values run first and
equal priorities preserve registration order.

```ts
request.interceptors.request.use(
  config => config,
  {
    priority: 10
  }
)
```

---

# Plugins

```ts
request.use(plugin)
request.unuse(pluginName)
request.hasPlugin(pluginName)
```

Official plugins:

```ts
retryPlugin()
cachePlugin()
circuitBreakerPlugin()
concurrencyPlugin()
authPlugin()
loggerPlugin()
uploadPlugin()
downloadPlugin()
```

Example:

```ts
const request = createClient()
  .use(retryPlugin())
  .use(authPlugin())
```

### Upload Progress

Upload progress uses native `XMLHttpRequest`, because Fetch does not expose
portable request-body progress events. Requests without `onProgress` continue
through the normal Fetch adapter.

```ts
const request = createClient().use(uploadPlugin())

const result = await request.post('/upload', {
  extensions: {
    upload: {
      data: {
        file,
        category: 'reports'
      },
      onProgress({ loaded, total, progress, bytes, rate, estimated }) {
        console.log({ loaded, total, progress, bytes, rate, estimated })
      }
    }
  }
})
```

The XHR upload path preserves URL, query, headers, timeout, cancellation,
status validation, retries, authentication refresh, response parsing, response
hooks and response interceptors. The browser generates the multipart boundary
automatically. See the
[XHR option limitations](configuration.md#xhr-transport-limitations) before
relying on native Fetch options with progress enabled.

### Download Progress Transport

`downloadPlugin()` prefers Fetch response streams for progress reporting. When
the runtime does not expose response streams, the default `auto` mode uses
native `XMLHttpRequest` before sending the request, so the file is never
downloaded twice.

```ts
const request = createClient().use(downloadPlugin())

const file = await request.get<Blob>('/report.pdf', {
  extensions: {
    download: {
      onProgress({ loaded, total, progress, bytes, rate, estimated }) {
        console.log({ loaded, total, progress, bytes, rate, estimated })
      }
    }
  }
})
```

The transport can be selected explicitly when runtime capability detection is
not reliable:

```ts
downloadPlugin({ transport: 'xhr' })
downloadPlugin({ transport: 'fetch' })
```

- `auto` (default): use Fetch streams when available, otherwise native XHR.
- `fetch`: always use Fetch stream progress.
- `xhr`: use native XHR whenever download progress is enabled.

Requests without `onProgress` continue through the normal Fetch adapter,
regardless of this option. XHR downloads preserve URL, query, headers,
`credentials: 'include'`, timeout, cancellation, status validation, retries,
authentication refresh, response hooks and response interceptors. Other Fetch
credential modes and Fetch-only options have documented
[XHR limitations](configuration.md#xhr-transport-limitations).

Upload and download progress share the same fields: cumulative `loaded`,
optional `total` and `progress`, per-event `bytes`, average bytes-per-second
`rate`, and remaining-seconds `estimated`. Rate estimates begin after a
250-millisecond sample; fields that cannot be determined are omitted.

Return a stream for large downloads that should retain backpressure instead of
being assembled into an in-memory Blob:

```ts
const stream = await request.get<ReadableStream<Uint8Array>>('/archive.zip', {
  maxResponseSize: 1024 * 1024 * 1024,
  extensions: {
    download: {
      output: 'stream',
      onProgress({ loaded, rate, estimated }) {
        console.log({ loaded, rate, estimated })
      }
    }
  }
})

await stream.pipeTo(destination)
```

Stream output requires the Fetch transport. Progress follows consumer reads,
cancellation propagates to the response body, and `maxResponseSize` remains
enforced during consumption. Body-read and progress-callback errors surface
from the stream reader or `pipeTo()` after the request promise has resolved.

Plugins must not replace client methods.

Plugins should extend the request lifecycle through supported extension points.
Responses supplied early by a request hook still pass through plugin response
hooks and user response interceptors. Response hooks run first so cache-like
plugins can store the unmodified parsed response and apply user transforms
exactly once per request.

## Plugin Lifecycle

```ts
const metricsPlugin: Plugin = {
  name: 'metrics',
  priority: 10,
  requires: ['logger'],
  conflicts: ['legacy-metrics'],

  install({ interceptors, hooks }) {
    interceptors.request.use(config => {
      return config
    })

    const disposeHook = hooks.onResponse(context => {
      // Record response metrics.
    })

    return () => {
      disposeHook()
      // Release any other plugin-owned resources.
    }
  }
}
```

- `priority` is the default priority for registrations made by the plugin.
- `requires` lists plugins that must already be installed.
- `conflicts` prevents incompatible plugins from being installed together.
- `install()` may return a synchronous cleanup function.
- `unuse()` automatically removes all interceptors and hooks registered
  through the plugin context, then runs the plugin cleanup.
- A plugin cannot be removed while another installed plugin requires it.
- Failed plugin installation automatically rolls back scoped registrations.

Plugin lifecycle failures throw `PluginError` with one of these codes:

```ts
MISSING_DEPENDENCY
PLUGIN_CONFLICT
DEPENDENCY_IN_USE
```

When priorities are equal, registrations run in their original registration
order. A registration-specific priority overrides the plugin default:

```ts
hooks.onRequest(handler, {
  priority: 20
})
```

Transport plugins use `hooks.onTransport(handler)`. Transport hooks execute
inside each retry attempt, after request hooks and before the configured
adapter. A handler sets `context.response` when it handles an attempt; later
transport hooks and the adapter are skipped for that attempt. Errors continue
through normal error, authentication-refresh, and retry hooks.

## Extension Configuration

Plugin-owned request configuration belongs under `extensions`:

```ts
await request.get('/user', {
  extensions: {
    retry: {
      retries: 2
    },
    cache: {
      enabled: true,
      ttl: 30000
    }
  }
})
```

The `retry`, `cache`, `circuitBreaker`, `concurrency`, `auth`, `logger`,
`upload` and `download` fields are accepted only inside `extensions`. Keeping
plugin-owned options namespaced prevents third-party extensions from
increasing the Core configuration surface.

Third-party plugins can add strongly typed configuration without modifying
Npora Request core types:

```ts
import type { Plugin } from '@npora/request'

interface MetricsOptions {
  enabled?: boolean
  sampleRate?: number
}

declare module '@npora/request' {
  interface RequestExtensions {
    metrics?: MetricsOptions
  }
}

export function metricsPlugin(): Plugin {
  return {
    name: 'metrics',

    install({ interceptors }) {
      interceptors.request.use(config => {
        const metrics = config.extensions?.metrics

        if (metrics?.enabled) {
          // Attach request metrics.
        }

        return config
      })
    }
  }
}
```

## Retry

```ts
const request = createClient().use(
  retryPlugin({
    retries: 2,
    delay: 200,
    methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
    respectRetryAfter: true,
    maxDelay: 60000,
    jitter: true,
    maxElapsedTime: 30000,
    onRetry(event) {
      metrics.recordRetry(event)
    }
  })
)
```

Retry defaults to idempotent methods. `POST` and `PATCH` are not retried unless
they are explicitly included in `methods`. Requests with a `ReadableStream`
body are not retried because their body cannot be replayed safely.

Retry delays are interrupted immediately when the request signal is aborted.
Asynchronous `shouldRetry`, delay and jitter results observe the same signal,
so application retry policies cannot keep an aborted request pending.
Valid `Retry-After` response headers take precedence over the configured delay
and are capped by `maxDelay`. They are not randomized.

Setting `jitter` to `true` applies full jitter between zero and the configured
delay, reducing synchronized retry spikes. A custom jitter function can return
an application-specific delay. `maxElapsedTime` stops retrying when the time
already spent plus the next planned delay would exceed the request's total
retry budget.

`onRetry` receives a `RetryEvent` containing the one-based retry `attempt`,
final `delay`, elapsed request time and error. Observer failures are isolated
and do not change the request result.

## Circuit Breaker

```ts
const breaker = circuitBreakerPlugin({
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 1,
  halfOpenMaxRequests: 1,
  maxCircuits: 1000,
  onStateChange(event) {
    metrics.recordCircuitState(event)
  }
})

const request = createClient()
  .use(retryPlugin({ retries: 2 }))
  .use(breaker)
```

The breaker counts final request outcomes, so exhausted retries contribute one
failure rather than one failure per attempt. By default it counts network and
timeout errors, HTTP `429`, and HTTP `5xx`. Successful requests reset the
consecutive failure count. Configuration, cancellation, parsing and ordinary
HTTP `4xx` errors do not open the circuit.

After `failureThreshold` consecutive failures, the circuit opens and rejects
new requests with `RequestError.code === 'CIRCUIT_OPEN'` before adapter I/O.
After `resetTimeout`, it enters half-open state and admits at most
`halfOpenMaxRequests` concurrent probes. `successThreshold` successful probes
close it; a counted probe failure opens it again and restarts the recovery
window. When `shouldCountFailure` is asynchronous, its pending classification
remains part of the probe lifecycle and continues occupying a half-open slot.
False results and rejected classifiers release the slot without leaving the
circuit permanently saturated. Aborting the probe also stops waiting for the
classifier and releases its slot; a late classifier result cannot mutate the
circuit afterward.

Circuits use the resolved request origin as their isolation key. Relative URLs
without an absolute `baseURL` share the `default` key. Override the key or
disable protection for one request:

```ts
await request.get('/health', {
  extensions: {
    circuitBreaker: {
      key: 'inventory-primary'
    }
  }
})

await request.get('/diagnostics', {
  extensions: {
    circuitBreaker: {
      enabled: false
    }
  }
})
```

Use `createKey` and `shouldCountFailure` for application-specific isolation and
failure policies. `onStateChange` failures are isolated from the request
lifecycle. Inspect or manually clear state with
`breaker.getState(key)`, `breaker.reset(key)`, or `breaker.reset()`.

The plugin retains at most 1,000 inactive circuit records by default and uses
LRU eviction when another isolation key is created. Configure the bound with
`maxCircuits`. Records with active requests are never evicted, so an extreme
burst of unique concurrent keys may temporarily exceed the configured bound;
the map is trimmed as requests settle.

## Concurrency Limiting

```ts
const concurrency = concurrencyPlugin({
  maxConcurrent: 20,
  maxQueue: 200,
  queueTimeout: 5000,
  maxKeys: 1000
})

const request = createClient().use(concurrency)
```

The plugin admits at most `maxConcurrent` logical requests for each isolation
key. Additional requests wait in FIFO order up to `maxQueue`; a full queue or
an expired `queueTimeout` rejects before adapter I/O with
`RequestError.code === 'CONCURRENCY_LIMIT'`. A logical request keeps its permit
across retry attempts and retry delays, then releases it after the final
settled lifecycle.

Keys use the resolved request origin by default. Relative URLs without an
absolute `baseURL` share the `default` key. Override the key, queue timeout, or
disable limiting for one request:

```ts
await request.get('/inventory', {
  extensions: {
    concurrency: {
      key: 'inventory-primary',
      queueTimeout: 1000
    }
  }
})

await request.get('/diagnostics', {
  extensions: {
    concurrency: {
      enabled: false
    }
  }
})
```

Queued requests observe their `AbortSignal`. Removing the plugin rejects all
queued requests with `ABORT_ERROR` and releases its state. Inspect a key with
`concurrency.getState(key)`, which reports active and queued counts.

The plugin retains at most `maxKeys` inactive key records using LRU eviction.
Records with active or queued requests are never evicted, so a burst of unique
concurrent keys may temporarily exceed the configured bound; records are
trimmed as requests settle.

## Cache

```ts
const cache = cachePlugin()
const request = createClient().use(cache)

await request.get('/user', {
  extensions: {
    cache: {
      enabled: true,
      ttl: 30000
    }
  }
})

cache.clear()
```

Cache entries expire after 30 seconds by default. Set `ttl` in milliseconds,
use `0` to disable persistent storage for a request, or use `Infinity` to retain
the entry indefinitely. Negative and non-numeric TTL values fail with
`CONFIG_ERROR` before a network request is sent.

Each cache plugin instance owns an isolated `MemoryCacheStore` by default.
It retains at most 1,000 entries with LRU eviction and removes expired entries
when they are read. Configure the built-in store with `maxEntries`; `0` disables
storage and `Infinity` explicitly removes the capacity bound. A custom `store`
owns and enforces its own capacity, so `maxEntries` is ignored when one is
provided.
Only `GET` and `HEAD` are cached. The generated cache key includes every
explicitly configured request header and guarantees variation by
`authorization`, `cookie`, `accept` and `accept-language`. This conservatively
isolates responses that name custom request headers in `Vary`. Query keys are
normalized independently of object insertion order, and different response
parsing types use separate cache entries. Responses marked with
`Cache-Control: no-store` or `Vary: *` may still be shared by equivalent
concurrent requests, but are never persisted in the cache store.

Concurrent equivalent requests share one network operation by default. Waiting
requests remain attached while the leader retries, receive independent copies
of the final response, and receive the final error if all retries fail. An
individual waiting request can be aborted without cancelling the leader.

Disable this behavior globally or for one request:

```ts
cachePlugin({
  dedupe: false
})

await request.get('/user', {
  extensions: {
    cache: {
      enabled: true,
      dedupe: false
    }
  }
})
```

Supply a `CacheStore` to share entries across plugin instances or connect an
external cache:

```ts
import type { CacheStore } from '@npora/request'

const store: CacheStore = {
  async get(key) {
    return database.get(key)
  },
  async set(key, entry) {
    await database.set(key, entry)
  },
  async delete(key) {
    await database.delete(key)
  },
  async clear() {
    await database.clear()
  }
}

const cache = cachePlugin({
  store
})

await cache.clear()
```

Store methods may be synchronous or asynchronous. Read, write and expiration
cleanup failures are treated as cache misses and do not change the network
result. Explicit `cache.clear()` failures remain visible to the caller.
Asynchronous request-scoped store operations observe the request signal, so a
stalled external store cannot keep an aborted request pending. The underlying
store operation is not forcibly cancelled and must implement its own I/O
cancellation when that is required.
`CacheEntry.raw` is optional so portable stores may persist parsed data and
response metadata without serializing a native `Response`.

Calling `cache.clear()` immediately starts a new cache and deduplication
generation. Requests started afterward never join an older in-flight leader,
and stale asynchronous reads or older responses cannot repopulate, overwrite or
delete entries in the new generation. Requests already sharing an older leader
still settle normally. Await `cache.clear()` when using an asynchronous store
before relying on the underlying store having finished its own clear operation.

The generated default key incorporates values from `varyHeaders`, including
authorization and cookies. External stores must treat cache keys as sensitive
or hash them before persistence and logging. They must also be isolated per
application or tenant when browser-private responses can reach a shared store.

Additional methods must be enabled explicitly:

```ts
cachePlugin({
  methods: ['GET', 'HEAD', 'POST']
})
```

Passing a custom `extensions.cache.key` bypasses automatic key generation, so the
application is responsible for including any user or authorization scope.

## Authentication

```ts
const request = createClient().use(
  authPlugin({
    token: () => accessToken,
    storage: tokenStorage,
    refreshToken: async () => {
      return refreshAccessToken()
    }
  })
)
```

Request-level `extensions.auth` values take precedence over plugin defaults.
Concurrent 401 responses share one refresh operation and persist its returned
token once. A refresh retry preserves the request-level authorization scheme.
When `refreshToken()` updates external state and returns `void`, token providers
and storage are read again before retrying. Failed refreshes preserve the
original request error and do not block later requests from trying again.

Each request observes its own `AbortSignal` while waiting for an initial token
provider or storage read, an asynchronous refresh policy, the shared refresh
operation, or a post-refresh token provider.
Cancelling one waiter does not cancel the shared refresh or other requests, and
listener cleanup failures cannot leave that waiter pending. Removing the auth
plugin prevents requests already waiting on refresh from injecting the new token
or retrying after the refresh completes.

## Logger

```ts
const request = createClient().use(loggerPlugin())
```

The default logger writes structured entries through `console.log` and
`console.error`. Supply a logger to forward entries to an application logging
or telemetry system:

```ts
import type { RequestLogger } from '@npora/request'

const logger: RequestLogger = {
  info(_message, entry) {
    applicationLogger.info(entry)
  },
  error(_message, entry) {
    applicationLogger.error(entry)
  }
}

const request = createClient().use(
  loggerPlugin({
    logger,
    createRequestId: () => crypto.randomUUID()
  })
)
```

All entries contain:

- `type`
- `requestId`
- `timestamp`
- `method`
- redacted `url`

Response entries also contain `status`, total `duration` in milliseconds, and
`attempts`. Error entries contain the failed `attempt`, total `duration`, error
name and message, and `code` or `status` when available. A retry therefore
emits an error entry for the failed attempt and a response entry with the same
`requestId` if a later attempt succeeds.

Error logs contain a safe summary instead of the complete `RequestError`, so
request headers, auth extension values, response bodies and causes are not
attached to the entry. Common credential query parameters such as
`access_token`, `refresh_token`, `api_key`, `password`, `secret` and
`signature` are redacted. Setting `extensions.logger.enabled` to `false`
disables all lifecycle logs for that request. Request-level logger options may
also replace the plugin defaults. Logger methods may be synchronous or
asynchronous; their failures are isolated and never change the request result.

---

# Response

```ts
interface NporaResponse<T> {
  data: T
  status: number
  statusText: string
  headers: Headers
  config: RequestConfig
  raw: Response
}
```

By default, client methods return `data`.

```ts
const data = await request.get<User>('/user')
```

Use a response method when status, headers or the native response is needed.

```ts
const response = await request.getResponse<User>('/user')

console.log(response.status)
console.log(response.headers)
console.log(response.raw)
```

---

# Error

All request errors should be thrown as `RequestError`.

```ts
try {
  await request.get('/user')
} catch (error) {
  if (error instanceof RequestError) {
    console.log(error.code)
    console.log(error.status)
    console.log(error.data)
    console.log(error.response)
    console.log(error.config)
  }
}
```

When an HTTP response is available, `RequestError<T>` preserves its parsed
body and complete response metadata.

Do not serialize the complete error into logs or telemetry. Its `config`,
`response`, `data`, and `cause` fields may contain credentials, request bodies,
response data, or other application secrets. Log an explicit allowlist such as
`name`, `message`, `code`, and `status`, or use `loggerPlugin` for a structured
safe summary.

Error codes:

```ts
CONFIG_ERROR
HTTP_ERROR
NETWORK_ERROR
TIMEOUT_ERROR
ABORT_ERROR
PARSER_ERROR
SCHEMA_ERROR
RESPONSE_TOO_LARGE
CIRCUIT_OPEN
CONCURRENCY_LIMIT
```

---

# Adapter

Default adapter:

```ts
FetchAdapter
```

Custom adapter:

```ts
createClient({
  adapter: customAdapter
})
```

Adapters are responsible for network I/O only.

Built-in adapters may expose an optional internal fast path:

```ts
requestValidated(config, validatedHeaders)
```

The client uses it only for the first adapter attempt. Custom adapters do not
need to implement it and continue to receive exactly `request(config)`.
Retries and direct adapter calls use the regular method and validate again.

---

# Stability

Starting with 1.0, the package follows Semantic Versioning. Package-root
exports, their TypeScript declarations and the behavior documented in this
contract are stable public API.

Breaking public API changes require a new major version. Additive,
backward-compatible functionality may be released in minor versions, and
backward-compatible fixes in patch versions.

Internal modules that are not exported from the package root may change
without notice.
