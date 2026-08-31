# Npora Request API

> Public API contract of Npora Request.

For option types, defaults, merge behavior, runtime support, and plugin-owned
request fields, see the [configuration reference](configuration.md).

## Core guarantees

- **Native transport model:** Fetch-compatible inputs, responses, cancellation,
  streams, and transport overrides remain visible instead of being hidden by a
  private request abstraction.
- **Two deliberate response APIs:** data-first methods return parsed values;
  complete-response methods add status, headers, effective configuration, and
  the native response without changing request configuration.
- **Bounded body handling:** request streams, successful responses, thrown HTTP
  error data, SSE, NDJSON, and progress streams honor explicit limits without
  forcing full-body buffering.
- **Stable failures:** transport, timeout, abort, HTTP, parser, schema, size,
  plugin, and configuration failures use typed errors with stable codes and
  preserve their causal metadata.
- **Deterministic extensibility:** interceptors and official plugins share an
  ordered lifecycle with isolated client state, cancellation, cleanup, and
  retry rules.
- **Portable delivery:** the same public contract is tested in Node.js,
  Chromium, Firefox, WebKit, Web Workers, ESM, and CommonJS, with zero runtime
  dependencies.

## Package entrypoints

The root entrypoint remains backward compatible and exports the complete API.
Applications may use subpaths to load a smaller runtime surface:

```ts
import { createClient } from '@npora/request/core'
import { cachePlugin } from '@npora/request/plugins/cache'
import { retryPlugin } from '@npora/request/plugins/retry'
```

Official plugin entrypoints are `auth`, `cache`, `circuit-breaker`,
`concurrency`, `download`, `logger`, `retry`, and `upload` under
`@npora/request/plugins/`. The aggregate plugin entrypoint remains available
at `@npora/request/plugins`. Import `MockAdapter` from
`@npora/request/testing` or its alias `@npora/request/adapters/mock`.

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
request.request<T>(nativeRequest, config?): Promise<T>
request.requestResponse<T>(nativeRequest, config?): Promise<NporaResponse<T>>
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

A native `Request`, including one created by another same-origin realm, can be
passed directly. Client defaults are applied first, then the Request URL,
method, headers, body, signal, and Fetch properties, followed by explicit
per-call overrides. Bodies are not cloned or buffered, and the original native
Request remains the Fetch input while URL, method, and body are unchanged.
Bodyless cross-realm Requests are supported. For a portable body-bearing
cross-realm call, provide an explicit replacement `body`, `json`, `form`, or
`formData`, because browsers do not transfer the original consistently. Callers
must not consume a Request body elsewhere after dispatch.

---

## HTTP Methods

```ts
request.get<T>(url, config?)
request.post<T>(url, config?)
request.put<T>(url, config?)
request.patch<T>(url, config?)
request.query<T>(url, config?)
request.delete<T>(url, config?)
request.head(url, config?)
request.options<T>(url, config?)
request.sse(url, config?)
request.ndjson<T>(url, config?)

request.getResponse<T>(url, config?)
request.postResponse<T>(url, config?)
request.putResponse<T>(url, config?)
request.patchResponse<T>(url, config?)
request.queryResponse<T>(url, config?)
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

`query()` implements the safe, idempotent, content-bearing HTTP QUERY method
defined by RFC 10008. Include a media type by using `json`, `form`, `formData`,
or an explicit `content-type` header with `body`. QUERY is retryable by default
when the body is replayable. The built-in cache excludes QUERY because its
current cache keys intentionally do not inspect request content; do not add it
to `cachePlugin({ methods })`.

---

# Config

## Base

```ts
{
  baseURL?: string
  allowAbsoluteUrls?: boolean
  url: string | URL
  method?: HttpMethod
  fetch?: FetchFunction
  fetchOptions?: FetchOptions
  parseJson?: JsonParser
  stringifyJson?: JsonStringifier
  context?: Record<string, unknown>
  headers?: HeadersInit
  removeHeaders?: readonly string[]
  query?: QueryParams
  querySerializer?: QuerySerializer
  searchParams?: URLSearchParams
  json?: unknown
  extensions?: RequestExtensions
}
```

`fetchOptions` passes native Fetch options to the adapter. Npora Request
continues to manage `method`, `headers`, `body` and `signal`.

Every method URL parameter and `RequestConfig.url` accepts a string or native
`URL`. Cross-realm URL objects are supported and are snapshotted to strings
before asynchronous lifecycle work. URL-shaped plain objects are rejected;
absolute URL boundary enforcement, query merging, cache keys, origin-isolated
plugins, and credential/query redaction use the normalized string.

`fetch` replaces `globalThis.fetch` for the built-in `FetchAdapter`. Client
defaults are inherited by `extend()` and individual requests may override the
function without bypassing request hooks, retries, caching, parsing, limits, or
error normalization.

`context` carries local metadata through request interceptors, plugin hooks,
parsers, responses, and errors. Client and request values are shallow merged;
nested objects are replaced. Context is never added to the native Fetch/XHR
request and does not affect automatic cache keys. `RequestError.toJSON()` omits
it with the rest of the potentially sensitive request configuration.

`parseJson` replaces `JSON.parse` for buffered JSON success and error bodies;
it may return a value or a promise. Its second parameter is typed as:

```ts
interface JsonParserContext {
  readonly config: RequestConfig
  readonly response: Response
}
```

The context contains the final request configuration and native response
metadata for success and HTTP-error bodies. The response body has already been
buffered. `stringifyJson` replaces `JSON.stringify` for `json` and plain-object
request bodies and must return a string. Both callbacks are inherited through
`extend()` and may be overridden per request. SSE and NDJSON stream parsing
are unchanged.

Header names merge case-insensitively. `removeHeaders` deletes inherited names
case-insensitively before request-specific headers are applied, so a request
can still explicitly replace a header removed by an extended client. Native
`Headers` values are preserved across JavaScript realms.

`json` accepts any value handled by the configured `stringifyJson` callback.
With the default serializer this includes every standard JSON root value, not
only objects and arrays. Explicit `null` is serialized as the four-byte JSON
body `null`; `undefined` means that the shortcut is not configured.

Object `query` parameters are shallow merged with client defaults. Native
`searchParams` replace inherited query defaults and preserve repeated keys,
entry order and native `URLSearchParams` encoding semantics. `query` and
`searchParams` are mutually exclusive.

`querySerializer` replaces the default object-query encoding and must return a
string. It is inherited through `extend()`, may be overridden per request, and
does not affect native `searchParams`. A leading `?` is removed before the
result is appended to the URL.

Absolute request URLs bypass `baseURL` by default. Set
`allowAbsoluteUrls: false` to reject absolute and protocol-relative request
URLs whenever `baseURL` is configured.

`baseURL` uses predictable path-prefix composition rather than WHATWG
`new URL(input, base)` resolution. Base query parameters are merged before the
request URL and configured query values, while fragments remain last and a
request fragment takes precedence. This prevents a base query or hash from
splitting the combined path into a malformed URL.

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

Body values may originate in another same-origin window or iframe. Native
`FormData`, nested `Blob` values, `ArrayBuffer`, and `ReadableStream` retain
their platform semantics across realms; streams remain unlocked during
detection, automatically receive Fetch half-duplex mode, and are not retried.

---

## Control

```ts
{
  timeout?: number
  totalTimeout?: number
  signal?: AbortSignal
  maxRequestSize?: number
  maxResponseSize?: number
  maxErrorResponseSize?: number
}
```

`timeout` is the per-attempt transport timeout. `totalTimeout` bounds the
complete operation, including request hooks, retries and delays, response
parsing, schema validation, response interceptors, and stream consumption. A
total deadline uses the same stable `TIMEOUT_ERROR` code and composes with the
caller's `signal`.

Timeout timers and composed abort listeners are released when a request
settles, times out or is externally aborted. `maxRequestSize` preflights
deterministically sized bodies and fails with `REQUEST_TOO_LARGE`. The Fetch
adapter also counts ReadableStream chunks during upload without buffering and
cancels the source on overflow; an allowed prefix may already be on the wire.
Native FormData and custom-adapter bodies require transport-specific limits.
`maxResponseSize` limits parsed and streamed response bytes and defaults to
`Infinity`. A response that exceeds the limit fails with
`RESPONSE_TOO_LARGE`; a trustworthy `Content-Length` can reject it before the
body is consumed.

Thrown HTTP error data has a separate 10 MiB default limit. If an error body
exceeds `maxErrorResponseSize`, the result remains an `HTTP_ERROR` with status,
headers, configuration, and raw response metadata, but `error.data` and
`error.response.data` are `undefined`. Set the option to `Infinity` to disable
this guard. A stricter explicit `maxResponseSize` remains a hard limit and
fails with `RESPONSE_TOO_LARGE`; `throwHttpErrors: false` bypasses the
error-only guard.

Reading and asynchronously parsing thrown HTTP error data uses the configured
per-attempt `timeout`. If that timeout is disabled, a 10-second fallback keeps
a never-ending error stream or parser from blocking error delivery and retries;
the result remains `HTTP_ERROR` with undefined data. Explicit timeout,
`totalTimeout`, and external abort failures retain their normal error codes.

---

## Response

```ts
{
  responseType?:
    | 'json'
    | 'text'
    | 'blob'
    | 'arrayBuffer'
    | 'bytes'
    | 'formData'
    | 'stream'
    | 'sse'
    | 'ndjson'
  schema?: StandardSchemaV1
  validateStatus?: (status: number) => boolean
  throwHttpErrors?: boolean
}
```

`throwHttpErrors` defaults to `true`. Set it to `false` to resolve parsed 4xx
and 5xx responses, preferably through a complete-response method so the status
can be inspected directly. This is mutually exclusive with `validateStatus`
at the same configuration level; a request or `extend()` policy replaces an
inherited policy. `validateStatus` remains the precise option for accepting a
custom status range. The switch affects HTTP status rejection only; transport,
timeout, cancellation, parsing, schema, and native Fetch error responses still
reject normally.

For rejected HTTP statuses, unreadable or malformed error payloads do not
replace the status failure: `HTTP_ERROR` is preserved with `data: undefined`.
Successful statuses and `throwHttpErrors: false` remain strict and report
`PARSER_ERROR` when their selected response parser fails.

Set `responseType: 'formData'` to parse multipart or URL-encoded response
bodies with the runtime's native `Response.formData()` implementation. This
works in the Fetch and XHR transports, remains subject to `maxResponseSize`,
and bypasses cache persistence and in-flight sharing because FormData is
mutable and not portable across persistent cache stores.

Set `responseType: 'bytes'` to receive a `Uint8Array` without manually wrapping
an ArrayBuffer. Native `Response.bytes()` is used when available, with a
portable `arrayBuffer()` fallback. Byte responses honor `maxResponseSize` and
bypass cache persistence and in-flight sharing.

When `responseType` is explicit, the client also sets a matching `Accept`
header unless the caller supplied one. JSON, text, FormData, SSE, and NDJSON
use representation-specific media types; binary and raw stream modes use
`*/*`. Automatic response detection leaves `Accept` unset, and request JSON
does not imply that the response must also be JSON.

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

Fetch `opaque` and `opaqueredirect` responses are also bodyless and resolve by
default with status `0` and `data: undefined`, preserving the unreadable native
response as `raw`. Supply `validateStatus` to reject status `0` deliberately.
Opaque-capable `no-cors` and manual-redirect requests bypass plugin caching and
in-flight sharing to prevent collisions with readable responses.

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
hooks or interceptors are installed. Complete successful response methods and
response lifecycle extensions preserve a separately readable `raw` Response
for buffered response types. HTTP errors consume their raw body once and expose
the parsed value through `error.data`, preventing an ignored error from retaining
an unread clone. Streaming response types likewise do not clone the body; their
`raw` response refers to the same body consumed by the async iterable.

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
XMLHttpRequest transports reject streams with `CONFIG_ERROR` instead of
attempting to coerce them.

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

Mock HTTP statuses follow `validateStatus` and `throwHttpErrors`, producing the
same response or `HTTP_ERROR` shape as Fetch and XHR. Network and timeout
failures can be simulated directly:

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
    methods: ['GET', 'HEAD', 'OPTIONS', 'QUERY', 'PUT', 'DELETE'],
    statusCodes: [408, 425, 429, 500, 502, 503, 504],
    retryOnTimeout: false,
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

By default, network failures, per-attempt timeouts, HTTP 408/425/429/5xx, and
HTTP 413 with a valid retry timing header are eligible. `statusCodes` replaces
only the HTTP status set; network failures remain eligible. A configured 413
still requires a timing header. `retryOnTimeout` independently controls timeout
retries and defaults to `true` for backward compatibility. `shouldRetry` may
return `true` or `false` to override the decision, or `undefined` to use these
defaults.

Retry delays are interrupted immediately when the request signal is aborted.
Asynchronous `shouldRetry`, delay and jitter results observe the same signal,
so application retry policies cannot keep an aborted request pending.
Valid `Retry-After`, `RateLimit-Reset`, `X-RateLimit-Retry-After`,
`X-RateLimit-Reset`, and `X-Rate-Limit-Reset` response headers take precedence
over the configured delay and are capped by `maxDelay`. `Retry-After` is
authoritative when present. Reset values may be delay seconds or current-era
Unix timestamps. Server delays are not randomized. HTTP 413 is retried by
default only when a valid timing header is present.

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

Inspect aggregate behavior or forward privacy-safe lifecycle events to an
application metrics system:

```ts
const cache = cachePlugin({
  onEvent(event) {
    metrics.increment(`request.cache.${event.type}`)
  }
})

const snapshot = cache.getStats()

console.log(snapshot.hits, snapshot.misses)
cache.resetStats()
```

Statistics cover hits, misses, bypasses, targeted invalidations, in-flight
deduplication, conditional revalidation, stale-if-error recovery,
stale-while-revalidate responses, and background refresh starts, successes,
and failures. Failed invalidations increment `invalidationErrors` and emit a
privacy-safe `invalidation-error` event. Each snapshot is a copy.
Resetting statistics does not clear cached data. Events contain only `type` and
`timestamp`; callback exceptions and rejected promises are ignored so
telemetry cannot change request results.

Requests using `parseJson` or `querySerializer` bypass cache persistence and
in-flight sharing by default because cached values and generated URL keys
cannot infer callback semantics. Set an explicit `extensions.cache.key` only
when that key safely identifies the parser output and serialized query.

Seed parsed data or update an existing entry by effective request
configuration:

```ts
await cache.set({ url: '/user', baseURL: '/api' }, user, {
  ttl: 30000,
  status: 200,
  headers: { 'content-type': 'application/json' },
  tags: ['user:1']
})

const found = await cache.update<User>(
  { url: '/user', baseURL: '/api' },
  current => ({ ...current, name: 'Local value' })
)
```

`set` defaults to status 200 and the request cache TTL (30 seconds by default).
`update` preserves metadata and freshness, returns `false` if the entry is
missing, and deletes it when the updater returns `undefined`. Updating parsed
data discards any stored raw response, so a later `getResponse()` refetches
instead of returning mismatched raw bytes. Both methods serialize with
same-key asynchronous operations and isolate their values from older in-flight
responses. Custom-store errors are returned to the caller.

Delete one entry by supplying the effective configuration that generated its
key:

```ts
await cache.delete({
  url: '/user',
  baseURL: '/api',
  responseType: 'json',
  headers: {
    accept: 'application/json'
  },
  extensions: {
    cache: { enabled: true }
  }
})
```

The effective configuration must include relevant client defaults and request
interceptor changes because `baseURL`, query values, response type, and
representation headers are key dimensions. When a request uses a custom
`extensions.cache.key`, only that key must match. Targeted deletion prevents
older same-key requests from repopulating the entry, detaches future callers
from old in-flight work, aborts the matching background refresh, and leaves
unrelated keys untouched. Await asynchronous-store deletion before depending
on completion; requests started meanwhile wait for it.

Associate related entries with tags and invalidate any entry matching at least
one tag:

```ts
await request.get('/users/1', {
  extensions: {
    cache: {
      enabled: true,
      tags: ['user:1', 'users']
    }
  }
})

const removed = await cache.invalidateTags(['user:1'])
```

Each entry accepts at most 32 unique tags of 1–128 characters. Tag validation
runs before cache reads and network I/O. The default `MemoryCacheStore` scans
its bounded entries and returns the number removed. A custom store must expose
`invalidateTags(tags): number | Promise<number>` or the plugin reports
`CONFIG_ERROR`. Matching in-flight requests are detached immediately, their
background refreshes are aborted, and older responses cannot repopulate the
invalidated entries. Requests with matching tags wait for an asynchronous
invalidation; unrelated tags continue normally.

Invalidate related reads automatically after a successful mutation:

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

Response caching does not need to be enabled on the mutation. Automatic
invalidation runs once after the complete request pipeline succeeds, so a
successful final retry invalidates once while HTTP, Schema, response
interceptor, cancellation, and exhausted-retry failures do not invalidate.
Asynchronous custom-store invalidation is awaited before the successful result
is delivered. Missing custom-store tag support and invalid tag configuration
fail before network I/O.

Cache entries expire after 30 seconds by default. Set `ttl` in milliseconds,
use `0` to disable persistent storage for a request, or use `Infinity` to retain
the entry indefinitely. Negative and non-numeric TTL values fail with
`CONFIG_ERROR` before a network request is sent.

Each cache plugin instance owns an isolated `MemoryCacheStore` by default.
It retains at most 1,000 entries with LRU eviction, including stale entries that
may still be conditionally revalidated. Configure the built-in store with
`maxEntries`; `0` disables storage and `Infinity` explicitly removes the
capacity bound. A custom `store` owns and enforces its own capacity, so
`maxEntries` is ignored when one is provided.
Only `GET` and `HEAD` are cached. The generated cache key includes every
explicitly configured request header and guarantees variation by
`authorization`, `cookie`, `accept` and `accept-language`. This conservatively
isolates responses that name custom request headers in `Vary`. Query keys are
normalized independently of object insertion order, and different response
parsing types use separate cache entries. Responses marked with
`Cache-Control: no-store` or `Vary: *` may still be shared by equivalent
concurrent requests, but are never persisted in the cache store.
The configured TTL is an application maximum: a valid response `max-age`
shortens it, and an `Age` header is subtracted from that server freshness
lifetime. Invalid or repeated `max-age` directives disable persistence.
Expired and `no-cache` entries carrying `ETag` or `Last-Modified` are retained
for conditional revalidation. A `304 Not Modified` response reuses the cached
status and body, merges updated response headers, and recalculates freshness.
Application-provided conditional headers and range requests are never
overwritten by the plugin.

Request `Cache-Control: no-cache` or `max-age=0` forces revalidation of an
otherwise fresh entry. Legacy `Pragma: no-cache` has the same effect when
`Cache-Control` is absent. Request `Cache-Control: no-store` bypasses cache
reads, writes, and in-flight sharing without deleting an existing entry.
`Cache-Control` and `Pragma` are control fields rather than representation key
dimensions, so the generated key excludes them. Responses that declare
`Vary: Cache-Control` or `Vary: Pragma` are therefore not persisted.

Response `Cache-Control: stale-if-error=N` allows an expired entry to recover
an eligible network, timeout, or 5xx failure for up to `N` seconds. Per-request
`extensions.cache.staleIfError` is measured in milliseconds; it enables a
local fallback window when the response omits the directive and caps the
server window when both exist. Configured retries are exhausted before stale
data is considered. Aborts, parsing, configuration, schema, and non-5xx HTTP
failures remain visible. Waiting deduplicated requests do not automatically
inherit a leader's stale fallback and continue through their own request
lifecycle.

Response `Cache-Control: stale-while-revalidate=N` permits an expired entry to
be returned immediately for `N` seconds while one deduplicated background
refresh runs. `extensions.cache.staleWhileRevalidate` is the application limit
in milliseconds and follows the same enable-or-cap rule as `staleIfError`.
Refreshes re-enter the owning client pipeline from the original request input,
so request interceptors, plugins, retries, Schema validation, response
interceptors, and custom adapters remain active exactly once. `cache.clear()`
and plugin removal abort active refreshes. Forced validation, response
`no-cache` or `must-revalidate`, application conditional headers, and range
requests disable immediate stale reuse.

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
  async invalidateTags(tags) {
    return database.deleteEntriesWithAnyTag(tags)
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
Custom stores must return stale entries from `get()` if conditional
revalidation is desired; stores that remove expired entries continue to behave
as ordinary cache misses.
Asynchronous request-scoped store operations observe the request signal, so a
stalled external store cannot keep an aborted request pending. The underlying
store operation is not forcibly cancelled and must implement its own I/O
cancellation when that is required.
`CacheEntry.raw` is optional so portable stores may persist parsed data and
response metadata without serializing a native `Response`.
`CacheEntry.tags` carries the bounded tag list used by grouped invalidation.

For browser persistence, pass an explicit `localStorage` or `sessionStorage`
instance to `WebStorageCacheStore`:

```ts
import {
  cachePlugin,
  WebStorageCacheStore
} from '@npora/request/plugins/cache'

const store = new WebStorageCacheStore(sessionStorage, {
  namespace: 'admin-console-v2',
  maxEntries: 500
})

const cache = cachePlugin({ store })
```

The namespace is 1–128 characters and scopes reads, deletion, tag invalidation,
LRU eviction, and `clear()` without touching other applications in the same
storage area. The default namespace is `default`; applications sharing an
origin should set a stable application-and-schema-specific value. `maxEntries`
defaults to 1,000, `0` disables reads and writes, and the least recently used
entry is removed at capacity.

Entries use JSON serialization. Parsed response data must therefore be
JSON-compatible: circular structures and `BigInt` fail storage, while values
such as `Date` follow normal JSON conversion. `Infinity` expiration is encoded
losslessly. Native `Response` bodies are deliberately omitted, so
`getResponse()` treats a restored raw-less entry as a miss and fetches a fresh
response. Malformed or incompatible records are removed on access. Storage
quota and access errors follow normal `CacheStore` behavior: background
request caching remains best effort, while explicit `cache.set()` and
`cache.update()` report the error.

Use `IndexedDBCacheStore` when synchronous Web Storage or JSON-only values are
not appropriate:

```ts
const store = new IndexedDBCacheStore(indexedDB, {
  databaseName: 'admin-console-cache',
  namespace: 'account:42',
  schemaVersion: 2,
  maxEntries: 1000,
  maxBytes: 50 * 1024 * 1024,
  quotaRecovery: true,
  shouldPersist(entry, estimatedBytes) {
    return entry.status === 200 && estimatedBytes < 2 * 1024 * 1024
  },
  onEvent(event) {
    metrics.record('persistent-cache', event)
  }
})

const cache = cachePlugin({ store })
const usage = await store.getUsage()
```

The adapter is fully asynchronous and uses IndexedDB structured cloning, so it
can retain `Blob`, `Date`, `Map`, `Set`, typed arrays, and `BigInt` values.
Native `Response` objects remain intentionally excluded. `databaseName` and
`namespace` each accept 1–128 characters. The defaults are
`@npora/request-cache` and `default`; applications should provide a stable,
application- and account-scoped namespace. LRU limits, scoped
`clear()`, tag invalidation, malformed-record cleanup, and `maxEntries: 0` have
the same semantics as the Web Storage adapter. Call `await store.close()` when
the database connection is no longer needed or before deleting/upgrading its
database.

`schemaVersion` is a positive safe integer from 1 through 1,000,000,000 and
defaults to `1`. Increase it monotonically whenever serialized cache values or
response assumptions become incompatible. Each version has distinct storage
keys. The first operation on a newer version removes malformed and
lower-version records in the same namespace, while a lower-version client
preserves higher-version records without validating or otherwise interpreting
their envelope. Its reads, writes, tag invalidation, LRU accounting, `clear()`,
`compact()`, and quota recovery do not touch higher versions. This prevents
updated and older tabs using this version-aware store from serving or
overwriting each other's cache during a rolling deployment, even when the
newer record structure is incompatible.

Records written before `schemaVersion` was introduced are treated as version
`1` and keep their original keys, so adopting the option is backward
compatible. This application schema version is independent from the internal
IndexedDB database version and does not run application migration code:
incompatible entries become misses and are fetched again. Keep `namespace`
stable when using `schemaVersion` for upgrades; changing both isolates the old
namespace but cannot prune it.

`maxBytes` defaults to `Infinity` and accepts a non-negative safe integer or
positive infinity. It applies an approximate stored-size budget to the current
schema version alongside `maxEntries`. Strings use their UTF-16 size; blobs,
array buffers, and typed arrays use their byte lengths; arrays, maps, sets,
objects, primitives, keys, and record metadata are traversed with cycle
protection. Browser storage engines may account for values differently, so the
limit is a deterministic application budget rather than an exact quota
measurement.

An entry larger than `maxBytes` is not persisted, removes any older same-key
value, and is treated as a cache miss on the next read. Otherwise, a write
evicts least-recently-used current-version entries until both entry and byte
limits are satisfied. Stored
size metadata is added lazily to compatible legacy records.

`quotaRecovery` defaults to `true`. When IndexedDB still rejects a write with
`QuotaExceededError`—for example because other origin storage consumes the
browser quota—the store removes malformed and lower-schema records plus the
oldest half of its current-schema entries, then retries once. The final error
is reported if no scoped data can be removed or the retry also fails. Set it to
`false` when eviction on quota pressure is not desired. Higher schema versions
and other namespaces are never removed by recovery.

`getUsage()` returns `{ entries, estimatedBytes, maxEntries, maxBytes,
schemaVersion }` for valid records in the current namespace and schema. It does
not expose cache keys or scan other namespaces. `onEvent` receives aggregated
events after committed cleanup, plus oversized-entry rejections. `type` is
`eviction` or `rejection`; `reason` is `max-entries`, `max-bytes`,
`quota-recovery`, `schema-version`, `malformed`, `oversized`,
`admission-policy`, or `expired`. Events contain
only the affected entry count, estimated bytes, and timestamp—never keys,
namespaces, URLs, headers, or response data. Synchronous throws and rejected
promises from observers are ignored so telemetry cannot break caching.

`shouldPersist(entry, estimatedBytes)` runs after structured-clone size
estimation for entries that fit `maxBytes`, and may return a boolean or a
promise. It receives a portable `CacheEntry` without the internal storage key,
namespace, access time, or schema metadata. Returning `false` removes any older
same-key value and emits an aggregate `rejection` event with reason
`admission-policy`. If the policy throws or rejects, `set()` reports that error
and preserves the old record. Non-boolean results produce a `CONFIG_ERROR`.
Because the callback can inspect parsed response data and headers, applications
must avoid logging or forwarding sensitive values from it.

Use `compact()` to reclaim current-schema entries that are no longer useful:

```ts
let result

do {
  result = await store.compact({
    expiredBefore: Date.now() - 7 * 24 * 60 * 60 * 1000,
    maxRemovals: 500
  })
} while (result.hasMore)
```

`expiredBefore` must be finite and defaults to `Date.now()`. An entry is
removed when `expiresAt <= expiredBefore`; choose an older boundary when stale
cache entries are retained for stale-while-revalidate or stale-if-error.
`maxRemovals` accepts a positive safe integer or `Infinity` and defaults to
`Infinity`. The result contains `scannedEntries`, `removedEntries`,
`estimatedBytesFreed`, `expiredBefore`, and conservative `hasMore`. A bounded
pass may report `hasMore: true` after removing the final eligible entry, so
repeat until it returns `false`. Cleanup emits aggregate `expired` events and
never exposes keys or values. Both `compact()` and `getUsage()` scan with an
IndexedDB cursor, keeping peak JavaScript memory independent of namespace size.

Compose a fast primary and durable secondary cache with `TieredCacheStore`:

```ts
const persistent = new IndexedDBCacheStore(indexedDB, {
  namespace: 'account:42',
  schemaVersion: 2
})

const store = new TieredCacheStore({
  primary: new MemoryCacheStore({ maxEntries: 200 }),
  secondary: persistent,
  broadcast: {
    channel: new BroadcastChannel('admin-cache:account:42:v2'),
    maxTrackedKeys: 1000
  },
  coordination: {
    locks: navigator.locks,
    namespace: 'admin-cache:account:42:v2'
  }
})

const cache = cachePlugin({ store })
```

Primary hits preserve the store's synchronous fast path. Primary misses read
the secondary tier and promote successful results; promotion failures do not
discard valid secondary data. Writes complete in the secondary tier before
updating the primary, preventing failed persistence from creating a memory-only
success. Delete and clear operations always attempt both tiers and report the
first failure after both settle.

Tag invalidation requires both stores to implement `invalidateTags()` and
returns the larger removal count, representing the best logical count when the
tiers mirror each other. External changes made directly to the secondary store
cannot evict another process or tab's primary memory entry; route mutations
through each active tiered store or use a cross-context invalidation channel.
Keep a reference to a closeable secondary store when its connection lifecycle
must be managed.

When `broadcast.channel` is supplied, successful writes and targeted deletes
send only a protocol version, random source identifier, action, and short
non-cryptographic key fingerprint. URLs, headers, response data, tags, and full
cache keys are never posted. Receiving contexts delete only the matching
primary key; unknown fingerprints, tag invalidation, and clear operations
conservatively clear the entire primary tier. The next read restores current
data from the shared secondary store. Fingerprint collisions therefore cause
only an extra miss, never reuse of the wrong response.

`maxTrackedKeys` defaults to 1,000 and accepts 1–100,000. Old tracking records
are bounded; a message for an untracked key falls back to clearing the primary.
Channel delivery is eventually consistent, so a read already in progress may
finish with its existing value. `store.dispose()` removes the listener but does
not close the caller-owned channel. Use a channel name scoped by application,
account, and cache schema version, and call both `dispose()` and
`channel.close()` during teardown.

When `coordination.locks` is supplied, cache misses and revalidations participate
in an exclusive Web Lock derived from `coordination.namespace` and a short key
fingerprint. A contender waits for the active request to settle, evicts its
possibly stale primary entry, and rereads the shared secondary tier. It returns
the newly cached response without another network request when possible; if the
leader failed or produced no cacheable entry, the waiter becomes the next
leader. This complements in-plugin request deduplication across independent
clients, tabs, workers, and windows on the same origin. `dedupe: false` disables
both forms of request sharing.

The namespace defaults to `npora-cache`, accepts 1–128 characters, and should
be scoped by application, account, and cache schema version. Lock names never
contain the complete cache key, URL, headers, or response data. Waiting honors
the request abort signal. Lock-manager failures fall back to an ordinary cache
miss unless the request was aborted, and `store.dispose()` releases active
leases. Configure this capability only where Web Locks are available, normally
with `locks: navigator.locks`.

Calling `cache.clear()` immediately starts a new cache and deduplication
generation. Requests started afterward never join an older in-flight leader,
and stale asynchronous reads or older responses cannot repopulate, overwrite or
delete entries in the new generation. Requests already sharing an older leader
still settle normally. Await `cache.clear()` when using an asynchronous store
before relying on the underlying store having finished its own clear operation.
Use `cache.delete(config)` when only one entry should be invalidated.

The generated default key incorporates values from `varyHeaders`, including
authorization and cookies, except for the cache control fields described
above. External stores must treat cache keys as sensitive or hash them before
persistence and logging. They must also be isolated per application or tenant
when browser-private responses can reach a shared store.

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
import {
  isRequestError,
  isSchemaValidationError
} from '@npora/request'

try {
  await request.get('/user')
} catch (error) {
  if (isRequestError(error)) {
    console.log(error.code)
    console.log(error.status)
    console.log(error.data)
    console.log(error.response)
    console.log(error.config)
  }
}
```

`isRequestError<T>(value)` recognizes every Npora request error, including
`SchemaValidationError`, and narrows its parsed data type to `T`.
`isSchemaValidationError<T>(value)` narrows schema-specific `issues` and
`schemaVendor`. Both guards use non-enumerable brands shared through the global
symbol registry, so they work across browser realms and duplicated copies of
the package. `instanceof` remains valid when producer and consumer use the same
constructor.

When an HTTP response is available, `RequestError<T>` preserves its parsed
body and complete response metadata.

`JSON.stringify(error)` and `error.toJSON()` return only `name`, `message`,
`code`, and the optional `status`, excluding structured request and response
data from routine logs and telemetry. Error messages are application-visible
text and should still follow your redaction policy. Directly logging or
spreading the complete error object can expose `config`, `response`, `data`, or
`cause`; use the serialized form or `loggerPlugin` when those fields may contain
application secrets.

Error codes:

```ts
CONFIG_ERROR
HTTP_ERROR
NETWORK_ERROR
TIMEOUT_ERROR
ABORT_ERROR
PARSER_ERROR
SCHEMA_ERROR
REQUEST_TOO_LARGE
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

Inject a Fetch-compatible implementation without replacing the adapter:

```ts
const request = createClient({
  fetch: instrumentedFetch
})
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
