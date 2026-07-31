# @npora/request

A TypeScript-first HTTP client built on the standard Fetch API.

Npora Request adds typed configuration, a predictable request lifecycle,
interceptors, plugins, unified errors, retries, caching, authentication, and
upload/download progress without adding runtime dependencies.

## Install

```sh
pnpm add @npora/request
```

```sh
npm install @npora/request
```

Node.js 22 or newer is required. Modern Chromium, Edge, Safari, WebKit, and Web
Workers are supported through their native Fetch implementations.

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

## Request configuration

```ts
await api.post('/users', {
  query: {
    notify: true
  },
  json: {
    name: 'Npora'
  },
  fetchOptions: {
    credentials: 'include'
  }
})
```

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

api.getResponse(url, config)
api.postResponse(url, config)
api.putResponse(url, config)
api.patchResponse(url, config)
api.deleteResponse(url, config)
api.headResponse(url, config)
api.optionsResponse(url, config)
```

## Plugins

```ts
import {
  authPlugin,
  cachePlugin,
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

Built-in plugins:

- `retryPlugin()`
- `cachePlugin()`
- `authPlugin()`
- `loggerPlugin()`
- `uploadPlugin()`
- `downloadPlugin()`

Plugin-owned request options belong under `extensions`. Third-party plugins can
augment `RequestExtensions` through TypeScript module augmentation.

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
