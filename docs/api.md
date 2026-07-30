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

request.getResponse<T>(url, config?)
request.postResponse<T>(url, config?)
request.putResponse<T>(url, config?)
request.patchResponse<T>(url, config?)
request.deleteResponse<T>(url, config?)
```

Example:

```ts
const user = await request.get<User>('/user')

const response = await request.getResponse<User>('/user')
console.log(response.headers)
```

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

---

## Response

```ts
{
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'
  validateStatus?: (status: number) => boolean
}
```

## Config Merge Rules

Client defaults and request configuration are merged deterministically:

- Request values override client defaults.
- Header names are merged case-insensitively.
- `query` and `fetchOptions` are shallow merged.
- Each `extensions` entry is shallow merged when both values are objects.
- Supplying a request body mode replaces the default body mode.

The body options `body`, `json`, `form` and `formData` are mutually exclusive.
Invalid headers, invalid timeout values and body configuration conflicts throw
a `RequestError` with code `CONFIG_ERROR` before any network request is sent.

---

# Interceptors

```ts
request.interceptors.request.use(config => config)

request.interceptors.response.use(response => response)

request.interceptors.error.use(error => error)
```

Interceptors are user-level extension points.

---

# Plugins

```ts
request.use(plugin)
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

Plugins must not replace client methods.

Plugins should extend the request lifecycle through supported extension points.

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

The previous top-level `retry`, `cache`, `auth`, `logger`, `upload` and
`download` fields remain available during v0.x, but are deprecated in favor of
their namespaced equivalents.

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
    maxDelay: 60000
  })
)
```

Retry defaults to idempotent methods. `POST` and `PATCH` are not retried unless
they are explicitly included in `methods`. Requests with a `ReadableStream`
body are not retried because their body cannot be replayed safely.

Retry delays are interrupted immediately when the request signal is aborted.
Valid `Retry-After` response headers take precedence over the configured delay
and are capped by `maxDelay`.

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
`authorization`, `cookie`, `accept` and `accept-language` headers.

Additional methods must be enabled explicitly:

```ts
cachePlugin({
  methods: ['GET', 'HEAD', 'POST']
})
```

Passing a custom `extensions.cache.key` bypasses automatic key generation, so the
application is responsible for including any user or authorization scope.

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

---

# Stability

Public APIs should remain stable.

Internal implementation may change.

User-facing API should not change unless absolutely necessary.
