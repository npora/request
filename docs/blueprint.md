# Npora Request Blueprint

> The development blueprint of Npora Request.

---

# Vision

Npora Request is a modern, TypeScript-first HTTP client built on top of the Fetch API.

It does not replace Fetch.

It provides a consistent, extensible and production-ready request layer for modern JavaScript applications.

---

# Goals

Npora Request focuses on:

- Modern
- Lightweight
- Type Safe
- Extensible
- Fetch First

The goal is to build a request library that is simple to use, easy to extend and stable to maintain.

---

# Non Goals

Npora Request is NOT:

- A GraphQL Client
- A WebSocket Client
- A RPC Framework
- A Backend Framework
- A Full Runtime

Npora Request focuses on HTTP only.

---

# Framework

```
Application
      │
      ▼
Client
      │
      ▼
Pipeline
      │
      ▼
Adapter
      │
      ▼
Fetch
```

## Client

Public API.

Responsible for:

- createClient()
- request()
- get()
- post()
- put()
- patch()
- delete()

The Client should stay lightweight.

The Client should not contain request business logic.

---

## Pipeline

Responsible for the request lifecycle.

Responsibilities:

- merge config
- request interceptors
- execute adapter
- response interceptors
- error interceptors

Pipeline coordinates the request flow.

Pipeline should never contain business features.

---

## Adapter

Responsible for network I/O.

Default implementation:

- Fetch Adapter

Future:

- Node Adapter
- Mock Adapter

Adapters should only communicate with the network.

Adapters should never implement Retry, Cache, Logger or business logic.

---

# Core

The Core is the foundation of the project.

Core modules should remain stable.

```
Client

Config

Pipeline

Adapter

Error
```

Adding new Core modules should be avoided.

Changing existing Core modules should be carefully reviewed.

---

# Extensions

Everything outside the Core belongs to Extensions.

Examples:

- Retry
- Cache
- Logger
- Auth
- Upload
- Download
- Progress
- Mock

Extensions should never increase the complexity of the Core.

Whenever possible, implement new features as Extensions.

---

# Design Principles

Npora Request follows these principles.

## Fetch First

Fetch is the default request engine.

---

## TypeScript First

All public APIs must provide complete TypeScript support.

---

## Extension First

Prefer extending the request lifecycle instead of modifying the Core.

---

## Test First

Every feature must include corresponding unit tests.

---

## Zero Runtime Dependency

Avoid unnecessary runtime dependencies.

---

## Modern Browser First

Npora Request targets modern browsers and modern JavaScript runtimes.

---

# Browser Support

Supported:

- Chrome
- Edge
- Firefox
- Safari
- Node.js 20+

Internet Explorer is not supported.

Polyfills are not included.

---

# Development Rules

Before implementing any feature, always answer one question.

> Is this Core or Extension?

If it belongs to Core:

Review the architecture carefully.

If it belongs to Extension:

Implement it without modifying the Core.

---

Never increase the complexity of the Core to support a feature.

Prefer adding an Extension instead.

---

# Roadmap

## v0.1

Core

- Client
- Config
- Pipeline
- Adapter
- Error

---

## v0.2

Request

- Timeout
- Abort
- Retry
- Cache

---

## v0.3

Business

- Auth
- Logger
- Upload
- Download

---

## v1.0

Stable API

Production Ready

---

# Philosophy

Keep the Core stable.

Everything else should be implemented as Extensions whenever possible.

Core evolves slowly.

Extensions evolve rapidly.

The architecture should allow the project to grow without continuously changing the Core.
