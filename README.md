# @nova/request

> A modern, TypeScript-first HTTP client powered by the Fetch API.

`@nova/request` is a lightweight, extensible HTTP client built on top of the native Fetch API. It is designed for modern JavaScript and TypeScript applications with a focus on type safety, flexibility, and plugin-driven architecture.

> 🚧 This project is under active development.

## Features

- 🚀 Fetch API based
- 📦 TypeScript First
- 🔌 Adapter Architecture
- 🧩 Plugin Ready
- ⚡ Lightweight
- 🌳 Tree Shakable

## Installation

```bash
npm install @nova/request
```

or

```bash
pnpm add @nova/request
```

> Currently under development and not yet published to npm.

## Quick Start

```ts
import { createClient } from '@nova/request'

const request = createClient({
  baseURL: 'https://jsonplaceholder.typicode.com'
})

const todo = await request.get('/todos/1')

console.log(todo)
```

## Roadmap

- [x] Core Client
- [x] Fetch Adapter
- [x] Request Context
- [ ] Timeout
- [ ] Abort Controller
- [ ] Interceptors
- [ ] Plugin System
- [ ] Retry
- [ ] Cache
- [ ] Upload / Download

## License

MIT © Nova Team
