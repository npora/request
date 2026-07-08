# @npora/request

> A modern, TypeScript-first HTTP client powered by the Fetch API.

`@npora/request` is a lightweight, extensible HTTP client built on top of the native Fetch API. It is designed for modern JavaScript and TypeScript applications with a strong focus on type safety, extensibility, and developer experience.

> 🚧 This project is under active development and is not yet production-ready.

## Features

- 🚀 Native Fetch API
- 📦 TypeScript First
- 🔌 Adapter Architecture
- 🧩 Plugin-ready Design
- 🔁 Retry Support
- ⚡ Lightweight
- 🌳 Tree Shakable
- 🛠 Modern ESM Package

## Installation

```bash
npm install @npora/request
```

or

```bash
pnpm add @npora/request
```

> The package is currently under development and has not been officially released.

## Quick Start

```ts
import { createClient } from '@npora/request'

const request = createClient({
  baseURL: 'https://jsonplaceholder.typicode.com'
})

const todo = await request.get('/todos/1')

console.log(todo)
```

## Retry

```ts
import { createClient } from '@npora/request'

const request = createClient({
  retry: {
    retries: 2,
    delay: attempt => attempt * 300
  }
})

const data = await request.get('/todos/1')

console.log(data)
```

## Roadmap

### v0.1

- [x] HTTP Client
- [x] Fetch Adapter
- [x] Request Context
- [x] Type System
- [x] Configuration Merge

### v0.2

- [x] Headers Merge
- [x] Query Builder
- [x] Body Serializer
- [x] Response Parser
- [x] Timeout
- [x] Abort Controller
- [x] Interceptors
- [x] Plugin System
- [x] Retry

### v0.3

- [ ] Cache
- [ ] Upload / Download
- [ ] Built-in Plugins
- [ ] Documentation

### v1.0

- [ ] Stable API
- [ ] Production Ready

## Philosophy

Npora Request is built around four core concepts:

- **Client** — Public API entry.
- **Pipeline** — Request lifecycle.
- **Context** — Shared request state.
- **Adapter** — Runtime implementation.

This architecture keeps the core lightweight while making the request pipeline highly extensible.

## License

MIT © Npora Team
