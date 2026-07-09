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
```

Generic request method.

```ts
const user = await request.request<User>({
  url: '/user',
  method: 'GET'
})
```

---

## HTTP Methods

```ts
request.get<T>(url, config?)
request.post<T>(url, config?)
request.put<T>(url, config?)
request.patch<T>(url, config?)
request.delete<T>(url, config?)
```

Example:

```ts
const user = await request.get<User>('/user')
```

---

# Config

## Base

```ts
{
  baseURL?: string
  url: string
  method?: HttpMethod
  headers?: HeadersInit
  query?: QueryParams
}
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

---

# Error

All request errors should be thrown as `RequestError`.

```ts
try {
  await request.get('/user')
} catch (error) {
  if (error instanceof RequestError) {
    console.log(error.code)
  }
}
```

Error codes:

```ts
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
