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
- Custom Adapter
- Unified Error Handling

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

request.request(config)

request.get(url)

request.post(url)

request.put(url)

request.patch(url)

request.delete(url)

request.use(plugin)

request.interceptors.request.use()

request.interceptors.response.use()

request.interceptors.error.use()
```

---

# Examples

See the `examples` directory.

```
examples
├── basic.ts
└── plugins.ts
```

---

# Documentation

Project documentation is located in the `docs` directory.

```
docs
├── blueprint.md
├── structure.md
├── features.md
└── api.md
```

- **Blueprint** — Project vision and architecture
- **Structure** — Directory responsibilities
- **Features** — Product roadmap
- **API** — Public API contract

---

# Browser Support

Supported runtimes:

- Chrome
- Edge
- Firefox
- Safari
- Node.js

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
