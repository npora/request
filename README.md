# @npora/request

> A modern, TypeScript-first HTTP client built on top of the Fetch API.

Npora Request is a lightweight and extensible request library for modern JavaScript applications.

It does not replace Fetch.

It enhances Fetch with a stable client API, config handling, interceptors, adapters, plugins and unified errors.

## Features

- Fetch First
- TypeScript First
- Zero Runtime Dependency
- Client Instance
- Config Merge
- Request / Response / Error Interceptors
- Fetch Adapter
- Mock Adapter
- Timeout
- Abort
- Retry Plugin
- Cache Plugin
- Auth Plugin
- Logger Plugin
- Upload Plugin
- Download Plugin

## Installation

```bash
pnpm add @npora/request
```

```bash
npm install @npora/request
```

> This package is still under active development.

## Quick Start

```ts
import { createClient } from '@npora/request'

const request = createClient({
  baseURL: 'https://jsonplaceholder.typicode.com'
})

const todo = await request.get('/todos/1')

console.log(todo)
```

## JSON Request

```ts
await request.post('/users', {
  json: {
    name: 'Npora'
  }
})
```

## Query

```ts
await request.get('/users', {
  query: {
    page: 1,
    keyword: 'npora'
  }
})
```

## Timeout

```ts
const request = createClient({
  timeout: 5000
})
```

## Abort

```ts
const controller = new AbortController()

request.get('/users', {
  signal: controller.signal
})

controller.abort()
```

## Interceptors

```ts
request.interceptors.request.use(config => {
  return {
    ...config,
    headers: {
      ...config.headers,
      authorization: 'Bearer token'
    }
  }
})

request.interceptors.response.use(response => {
  return response
})

request.interceptors.error.use(error => {
  return error
})
```

## Plugins

### Retry

```ts
import { createClient, retryPlugin } from '@npora/request'

const request = createClient().use(
  retryPlugin({
    retries: 2,
    delay: 300
  })
)
```

### Cache

```ts
import { cachePlugin, createClient } from '@npora/request'

const request = createClient().use(cachePlugin())

await request.get('/users', {
  cache: {
    enabled: true,
    ttl: 30000
  }
})
```

### Auth

```ts
import { authPlugin, createClient } from '@npora/request'

const request = createClient().use(
  authPlugin({
    token: () => localStorage.getItem('token') ?? ''
  })
)
```

### Logger

```ts
import { createClient, loggerPlugin } from '@npora/request'

const request = createClient().use(loggerPlugin())
```

### Upload

```ts
import { createClient, uploadPlugin } from '@npora/request'

const request = createClient().use(uploadPlugin())

await request.request({
  url: '/upload',
  upload: {
    data: {
      name: 'Npora'
    }
  }
})
```

### Download

```ts
import { createClient, downloadPlugin } from '@npora/request'

const request = createClient().use(downloadPlugin())

const file = await request.get<Blob>('/download', {
  download: {
    filename: 'file.txt'
  }
})
```

## Mock Adapter

```ts
import { MockAdapter } from '@npora/request'

const adapter = new MockAdapter()

adapter.on('/user', () => ({
  name: 'Npora'
}))
```

## Design

Npora Request follows three rules:

- Keep the Core stable.
- Build everything else as extensions.
- Do not add runtime dependencies unless necessary.

See:

- `docs/blueprint.md`
- `docs/features.md`
- `docs/structure.md`

## Browser Support

Supported:

- Chrome
- Edge
- Firefox
- Safari
- Node.js 20+

Internet Explorer is not supported.

Polyfills are not included.

## License

MIT © Npora Team
