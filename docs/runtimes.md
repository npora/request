# Runtime support

The core requires Fetch-compatible APIs. Package export conditions select files;
they do not supply Fetch, Headers, AbortController, Response, or ReadableStream.
The existing ESM/CommonJS entries work across the tested environments without
separate browser/worker/node implementations.

| Environment | Executable verification | Scope |
| --- | --- | --- |
| Node.js 22/24/26 | Runtime CI and installed-package consumers | ESM/CommonJS and HTTP contracts |
| Chromium, Firefox, WebKit | Playwright | Browser APIs, cookies, serialization, cancellation and streaming |
| Dedicated Web Worker | Browser suite | Worker imports and request behavior |
| Service Worker | `browser/tests/service-worker.spec.ts` in all three engines | JSON/schema, multipart, abort, timeout, SSE states, NDJSON, tiered memory cache, form-error helper |
| Cloudflare-compatible workerd | `test/edge/run.mjs`, Miniflare 4.20260730.0, compatibility date 2026-07-30 | Same runtime contracts through a service binding, without Node compatibility flags |
| Injected Undici | `test/edge/undici.test.mjs` | Real loopback HTTP, pooled connection reuse, timeout, abort and stream cleanup |
| Vercel Edge, React Native, WeChat Mini Program, Uniapp, Taro | Not verified | Do not infer support from conditional exports or adapter injection |

The workerd suite is local runtime verification, not a deployment to Cloudflare.
Service bindings and localhost do not establish external TLS/proxy behavior,
production limits, or correctness of every plugin combination. Service Worker
support does not imply arbitrary requests survive worker termination.

## Optional cache coordination

`TieredCacheStore` does not read `navigator` or require Web Locks when
`coordination` is omitted. The cache plugin's in-flight sharing remains scoped to
its own installed instance. To enable cross-context refresh coordination, supply
an available lock manager explicitly:

```ts
const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
const store = new TieredCacheStore({
  primary,
  secondary,
  ...(typeof locks?.request === 'function' ? { coordination: { locks } } : {})
})
```

Explicit malformed coordination is a `CONFIG_ERROR`; it does not silently lose
the requested cross-context guarantee. Broadcast channels must implement
`addEventListener`, `removeEventListener`, and `postMessage`. The caller owns the
channel; dispose stores when finished.

An instance-local Map cannot coordinate separate Edge isolates. Use shared
storage/distributed coordination when the application needs that guarantee.
Web Locks may be available in Worker environments: test capabilities rather
than classifying all workers as unsupported.

## Reproduce

```sh
pnpm build
npm ci --prefix test/edge --ignore-scripts
npm audit --prefix test/edge --audit-level high
pnpm test:edge
pnpm test:browser
```

The isolated fixture pins Undici 7.29.1 and overrides sharp to 0.35.5 to address
advisories in Miniflare's pinned dependencies. The fixture is audited and tested
in CI; none of its dependencies enter the published package.
