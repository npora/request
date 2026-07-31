# Npora Request API

> Public API contract of Npora Request.

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

request.getResponse<T>(url, config?)
request.postResponse<T>(url, config?)
request.putResponse<T>(url, config?)
request.patchResponse<T>(url, config?)
request.deleteResponse<T>(url, config?)
request.headResponse(url, config?)
request.optionsResponse<T>(url, config?)
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
  extensions?: RequestExtensions
}
```

`fetchOptions` passes native Fetch options to the adapter. Npora Request
continues to manage `method`, `headers`, `body` and `signal`.

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
}
```

---

## Control

```ts
{
  timeout?: number
  signal?: AbortSignal
}
```

Timeout timers and composed abort listeners are released when a request
settles, times out or is externally aborted.

---

## Response

```ts
{
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'
  validateStatus?: (status: number) => boolean
}
```

Data-only methods parse successful Fetch responses directly when no response
hooks or interceptors are installed. Complete response methods, response
lifecycle extensions and HTTP errors preserve a separately readable `raw`
Response.

## Config Merge Rules

Client defaults and request configuration are merged deterministically:

- Request values override client defaults.
- Header names are merged case-insensitively.
- `query` and `fetchOptions` are shallow merged.
- Each `extensions` entry is shallow merged when both values are objects.
- Supplying a request body mode replaces the default body mode.

The body options `body`, `json`, `form` and `formData` are mutually exclusive.
`GET` and `HEAD` requests cannot include a body. Invalid headers, invalid
timeout values, unsupported method/body combinations and body configuration
conflicts throw a `RequestError` with code `CONFIG_ERROR` before any network
request is sent. Configuration is validated again after plugin request hooks,
including when a custom adapter is used.

---

# Interceptors

```ts
request.interceptors.request.use(config => config)

request.interceptors.response.use(response => response)

request.interceptors.error.use(error => error)
```

Interceptors are user-level extension points.

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
      onProgress({ loaded, total, progress }) {
        console.log({ loaded, total, progress })
      }
    }
  }
})
```

The XHR upload path preserves URL, query, headers, timeout, cancellation,
status validation, response parsing, response hooks and response interceptors.
The browser generates the multipart boundary automatically.

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
      onProgress({ loaded, total, progress }) {
        console.log({ loaded, total, progress })
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
credentials, timeout, cancellation, status validation, response hooks and
response interceptors.

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

The `retry`, `cache`, `auth`, `logger`, `upload` and `download` fields are
accepted only inside `extensions`. Keeping plugin-owned options namespaced
prevents third-party extensions from increasing the Core configuration surface.

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

Each cache plugin instance owns an isolated memory store. By default only
`GET` and `HEAD` are cached. The generated cache key varies by
`authorization`, `cookie`, `accept` and `accept-language` headers. Query keys
are normalized independently of object insertion order, and different response
parsing types use separate cache entries.

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

Error codes:

```ts
CONFIG_ERROR
HTTP_ERROR
NETWORK_ERROR
TIMEOUT_ERROR
ABORT_ERROR
PARSER_ERROR
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
