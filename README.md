# @npora/request

> A modern, TypeScript-first HTTP client built on top of the Fetch API.

Npora Request provides a consistent, extensible and production-ready request layer for modern JavaScript applications.

It does **not** replace Fetch.

It builds on top of the Fetch API while keeping the native request model.

---

# Features

- Fetch First
- TypeScript First
- Lightweight
- Extensible
- Zero Runtime Dependency
- Plugin Architecture
- Typed Extension Configuration
- Client Default Inheritance
- Retry, Cache and Authentication
- Custom Adapter
- Unified Error Handling
- Browser and Web Worker Support

---

# Installation

```bash
pnpm add @npora/request
```

or

```bash
npm install @npora/request
```

---

# Quick Start

```ts
import { createClient } from '@npora/request'

interface User {
  id: number
  name: string
}

const request = createClient({
  baseURL: 'https://api.example.com'
})

const user = await request.get<User>('/users/1')

console.log(user)
```

---

# Public API

```ts
const request = createClient(options)

const childRequest = request.extend(options)

request.request(config)

request.requestResponse(config)

request.get(url)

request.getResponse(url)

request.post(url)

request.put(url)

request.patch(url)

request.delete(url)

request.head(url)

request.options(url)

request.use(plugin)

request.unuse(pluginName)

request.hasPlugin(pluginName)

request.interceptors.request.use()

request.interceptors.response.use()

request.interceptors.error.use()
```

Data-first methods return the parsed response body. Use `requestResponse()` or
an HTTP `*Response()` method when status, headers or the native `Response` is
needed.

---

# Configuration

```ts
const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: {
    'x-app': 'dashboard'
  },
  query: {
    locale: 'en'
  },
  fetchOptions: {
    credentials: 'include'
  }
})

const adminApi = api.extend({
  baseURL: 'https://api.example.com/admin',
  headers: {
    'x-role': 'admin'
  }
})
```

`extend()` creates an isolated child client. It inherits configuration and the
adapter, while plugins and interceptors remain instance-scoped.

Request configuration overrides client defaults. Headers are merged
case-insensitively, while query parameters, native Fetch options and extension
configuration are merged by their documented rules.

---

# Complete Responses

```ts
const response = await api.getResponse<User>('/users/1')

console.log(response.data)
console.log(response.status)
console.log(response.headers)
console.log(response.raw)
```

---

# Plugins

```ts
import {
  authPlugin,
  cachePlugin,
  retryPlugin
} from '@npora/request'

const request = createClient({
  baseURL: 'https://api.example.com'
})
  .use(retryPlugin({
    retries: 2,
    delay: 200
  }))
  .use(cachePlugin())
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
```

Plugin configuration belongs under `extensions`. Legacy top-level plugin
fields remain available during v0.x but are deprecated.

---

# Error Handling

```ts
import { RequestError } from '@npora/request'

try {
  await request.get('/users/missing')
} catch (error) {
  if (error instanceof RequestError) {
    console.error(error.code)
    console.error(error.status)
    console.error(error.data)
    console.error(error.response)
  }
}
```

Errors use stable codes including `CONFIG_ERROR`, `HTTP_ERROR`,
`NETWORK_ERROR`, `TIMEOUT_ERROR`, `ABORT_ERROR` and `PARSER_ERROR`.

---

# Examples

See the `examples` directory.

```
examples
├── basic.ts
├── custom-plugin.ts
├── error-handling.ts
└── plugins.ts
```

Examples are typechecked in CI with `pnpm test:examples`.

---

# Performance

Run the request-pipeline benchmark:

```sh
pnpm benchmark
```

It reports sequential and concurrent throughput, latency percentiles and heap
movement for the adapter, client and plugin pipeline. CI stores a JSON report
for comparisons between equivalent runners. See
[`docs/benchmark.md`](docs/benchmark.md) for methodology and options.

Verify the built entrypoint, declaration, gzip and npm tarball size budgets:

```sh
pnpm build
pnpm test:size
```

See [`docs/package-size.md`](docs/package-size.md) for the checked metrics and
budget policy.

The ecosystem evaluation covers Axios and nine representative GitHub request
libraries with equivalent local HTTP workloads. Competitor packages were
removed after measurement and are not project dependencies. See
[`docs/comparison.md`](docs/comparison.md) for the snapshot and design
decisions.

---

# Documentation

Project documentation is located in the `docs` directory.

```
docs
├── benchmark.md
├── blueprint.md
├── comparison.md
├── features.md
├── package-size.md
├── structure.md
└── api.md
```

- **Blueprint** — Project vision and architecture
- **Benchmark** — Performance measurement methodology
- **Comparison** — Ten-library ecosystem evaluation
- **Package Size** — Published asset budgets and regression checks
- **Structure** — Directory responsibilities
- **Features** — Product roadmap
- **API** — Public API contract

---

# Browser Support

Supported runtimes:

- Chrome
- Edge
- Safari
- Node.js 22+
- Web Workers

Automated runtime coverage uses Node.js 22, 24, and 26 integration and package
tests plus Playwright browser tests for Chromium and WebKit. Firefox is
outside the current verification scope.

Internet Explorer is **not supported**.

---

# Roadmap

## v0.1

Core

- Client
- Config
- Pipeline
- Adapter
- Error

## v0.2

Request

- Timeout
- Abort
- Retry
- Cache

## v0.3

Business

- Auth
- Logger
- Upload
- Download

## v1.0

Stable API

Production Ready

---

# License

MIT © Npora Team
