# Migrating from Axios or Ky

Npora Request keeps Fetch semantics while returning parsed response data by
default. Migration is usually mechanical, but error handling, request bodies,
plugins, and complete responses deserve explicit decisions.

## From Axios

### Create an instance

```ts
// Axios
const api = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 5000
})

// Npora Request
const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000
})
```

### Send JSON and query parameters

Axios accepts the body as the second method argument. Npora Request keeps all
request configuration in one object and uses `json` for JSON serialization:

```ts
// Axios
await api.post('/users', { name: 'Ada' }, {
  params: { notify: true }
})

// Npora Request
await api.post('/users', {
  json: { name: 'Ada' },
  query: { notify: true }
})
```

Use `searchParams` when repeated keys, insertion order, or native URL encoding
must be preserved exactly.

### Read complete responses

Axios always resolves with a response wrapper. Npora Request data methods
resolve with parsed data and response methods expose metadata:

```ts
const data = await api.get<User>('/users/1')
const response = await api.getResponse<User>('/users/1')

console.log(response.data, response.status, response.headers, response.raw)
```

### Replace interceptors and resilience helpers

Application-specific transforms can remain interceptors. Cross-cutting
features should use plugins so ordering, retries, cleanup, and errors share the
same lifecycle:

```ts
const api = createClient()
  .use(retryPlugin({ retries: 2 }))
  .use(circuitBreakerPlugin())
  .use(concurrencyPlugin({ maxConcurrent: 20 }))
```

Axios cancellation tokens should become a native `AbortSignal`. Axios
`transformRequest` and `transformResponse` callbacks usually become request or
response interceptors. Node-specific agents, proxies, HTTP/2, or socket
options require a custom adapter because they are not portable Fetch options.

## From Ky

### Parse responses

Ky returns a response promise with body helpers. Npora Request selects a
parser from `responseType` or the response media type and returns the parsed
value:

```ts
// Ky
const user = await ky.get('/users/1').json<User>()

// Npora Request
const user = await api.get<User>('/users/1')
```

Use `getResponse()` when native response metadata is needed.

### Map common options

| Ky | Npora Request |
| --- | --- |
| `prefix` or `baseUrl` | `baseURL` |
| `searchParams` | `query` or native `searchParams` |
| `json` | `json` |
| `timeout` | `timeout` |
| `signal` | `signal` |
| `hooks.beforeRequest` | request interceptor or plugin request hook |
| `hooks.afterResponse` | response interceptor or plugin response hook |
| `hooks.beforeRetry` | `retryPlugin({ onRetry })` |
| `.json(schema)` | request `schema` |

Ky retries by default. Npora Request does not retry unless `retryPlugin()` is
installed and a retry count is configured. This makes network repetition an
explicit application policy.

## Error handling

Use `RequestError` and its stable `code` rather than matching messages:

```ts
try {
  await api.get('/users/1')
} catch (error) {
  if (error instanceof RequestError) {
    console.error(error.code, error.status, error.data)
  }
}
```

`SchemaValidationError` extends `RequestError`. Timeout, abort, network,
parsing, validation, response-size, concurrency, and circuit failures use
documented stable codes.

## Migration checklist

1. Replace instance defaults and method calls.
2. Move request bodies into `json`, `form`, `formData`, or `body`.
3. Choose data methods or complete-response methods per call site.
4. Replace cancellation tokens with `AbortSignal`.
5. Move resilience behavior into plugins and keep business transforms in
   interceptors.
6. Add Standard Schema validation at untrusted API boundaries.
7. Verify proxy, agent, redirect, cookie, and CORS assumptions in the target
   runtime.
8. Run integration tests against real error bodies, streaming responses, and
   retryable failures before removing the previous client.
