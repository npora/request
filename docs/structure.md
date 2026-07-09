# Npora Request Structure

> Project directory definition.

---

# Overview

```
src
├── adapters
├── client
├── core
├── errors
├── interceptors
├── plugins
├── types
├── utils
└── index.ts
```

Every directory has a single responsibility.

Do not mix responsibilities.

---

# client

Responsible for the public API.

Contains:

- createClient()
- request()
- get()
- post()
- put()
- patch()
- delete()

Rules:

- Keep the Client lightweight.
- Do not implement business features here.
- Do not communicate with the network directly.

---

# core

Responsible for the request workflow.

Contains:

- Config
- Context
- Pipeline

Rules:

- Core should remain stable.
- Avoid adding new Core modules.
- Business features should not be implemented here.

---

# adapters

Responsible for network communication.

Contains:

- Fetch Adapter

Future:

- Node Adapter
- Mock Adapter

Rules:

- Only perform network I/O.
- Never implement Retry.
- Never implement Cache.
- Never implement Logger.
- Never implement business logic.

---

# interceptors

Responsible for request lifecycle interception.

Contains:

- Request Interceptor
- Response Interceptor
- Error Interceptor

Rules:

- User-facing extension point.
- Should not contain request implementation.

---

# plugins

Responsible for optional features.

Examples:

- Retry
- Cache
- Auth
- Logger
- Upload
- Download
- Progress
- Mock

Rules:

- Plugins extend the request lifecycle.
- Plugins should never modify the Core architecture.
- Plugins should remain independent whenever possible.

---

# errors

Responsible for unified error definitions.

Contains:

- RequestError
- TimeoutError
- AbortError
- NetworkError

Rules:

- All public errors should be defined here.
- Do not throw raw browser errors.

---

# types

Responsible for public TypeScript definitions.

Contains:

- RequestConfig
- RequestContext
- RequestOptions
- Response
- Plugin

Rules:

- Export all public types.
- Do not place implementation here.

---

# utils

Responsible for shared utility functions.

Examples:

- mergeConfig
- parser
- serializer
- createTimeoutSignal

Rules:

- Utilities must be pure.
- Utilities must have no side effects.
- Utilities must not depend on business features.

---

# index.ts

Package public entry.

Rules:

- Export only public APIs.
- Never export internal modules.

---

# Design Rules

The following rules should always be followed.

## One Responsibility

Each directory should have only one responsibility.

---

## Stable Core

Core should change as little as possible.

---

## Extension First

New features should be implemented as Extensions whenever possible.

---

## No Circular Dependency

Dependencies should always point inward.

```
Client
        │
        ▼
Core
        │
        ▼
Adapter
```

Plugins may depend on Core.

Core must never depend on Plugins.

---

## Future

New top-level directories should not be created unless there is a clear architectural reason.

Future directories may include:

```
src
├── testing
└── index.ts
```

Everything else should fit into the existing structure.

---

# Directory Growth Strategy

When adding a new feature:

1. Check whether an existing directory can hold it.

2. If yes, extend the existing directory.

3. If not, discuss the architecture before creating a new top-level directory.

Avoid unnecessary directory expansion.

The project should remain simple as it grows.
