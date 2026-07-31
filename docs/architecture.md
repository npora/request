# Architecture

Npora Request is a Fetch-first request layer. It keeps network I/O in adapters,
request orchestration in the core pipeline, and optional behavior in plugins.

## Request flow

```text
Client defaults + request config
              │
              ▼
       configuration merge
              │
              ▼
      request interceptors
              │
              ▼
         request hooks
              │
              ▼
            adapter
              │
              ▼
        response hooks
              │
              ▼
     response interceptors
```

Failures enter the plugin error hooks and user error interceptors. Retry hooks
may restart the adapter stage with the same request context.

## Responsibilities

### Client

`createClient()` and `Client` expose the public request API. A client owns its
defaults, adapter, interceptors, and installed plugins. `extend()` creates a new
client with merged defaults and the selected adapter; lifecycle registrations
are intentionally not copied.

### Core

The core merges configuration, validates it, owns request context, and
coordinates the pipeline. Business features do not belong in this layer.

### Adapters

Adapters perform network I/O and return `NporaResponse`. `FetchAdapter` is the
default for browsers, workers, and supported Node.js releases. `MockAdapter`
supports deterministic tests. Custom adapters implement `request(config)`;
built-in fast paths are internal and optional.

### Interceptors

Request, response, and error interceptors are application-level extension
points. Priority is resolved when registrations change, so requests use cached
execution order.

### Plugins

Plugins add retry, caching, authentication, logging, and transfer progress
through scoped interceptors and hooks. A plugin may declare dependencies and
conflicts, return cleanup logic, and be removed with `unuse()`.

The final `onSettled` hook runs after response/error interceptors and all retry
decisions. It is intended for terminal coordination such as releasing
deduplicated cache followers. Settled observers are isolated: one observer
cannot replace the request result or prevent later settled observers.

Plugin request configuration belongs under `RequestConfig.extensions`.
Third-party packages extend `RequestExtensions` instead of adding fields to the
core configuration type.

## Dependency direction

```text
client ──▶ core ──▶ adapters/utilities
   │          │
   └────▶ interceptors

plugins ──▶ public lifecycle contracts
```

The core never imports official plugins. Internal utilities are not exported
from the package root.

## Design constraints

- Fetch is the default transport.
- Public APIs are TypeScript-first and follow SemVer.
- The package has zero runtime dependencies.
- Optional behavior is implemented as an extension whenever practical.
- All request configuration is validated before network I/O.
- Resource cleanup is required for timeout, abort, streams, XHR, hooks, and
  plugin registrations.
- ESM and CommonJS consumers use the same public contract.
- Runtime and type exports are checked against exact allowlists.

## Source layout

```text
src/
├── adapters/       network and mock transports
├── client/         public client implementation
├── core/           merge and request pipeline
├── errors/         stable public errors
├── interceptors/   user and plugin lifecycle managers
├── plugins/        official extensions
├── types/          public TypeScript contracts
├── utils/          internal request construction helpers
└── index.ts        package-root exports
```

New top-level modules require a clear responsibility that cannot fit an
existing layer. New product behavior should normally begin as a plugin.
