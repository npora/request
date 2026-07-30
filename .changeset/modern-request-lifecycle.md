---
"@npora/request": minor
---

Add a production-ready request lifecycle and extension API.

- Add complete response methods, client configuration inheritance, and HEAD
  and OPTIONS shortcuts.
- Add typed extension configuration and managed plugin priority, dependency,
  conflict, rollback, cleanup, and uninstall lifecycles.
- Harden retry, cache, authentication, timeout, configuration validation,
  pipeline error handling, short-circuit responses, and logger redaction.
- Add automatic native XHR fallback for download progress, explicit transport
  selection, stream cancellation, and concurrent download stress coverage.
- Add native XHR upload progress with shared transport resource cleanup and
  concurrent Node and browser stress coverage.
- Add Node integration, Chromium/WebKit, Web Worker, package entrypoint,
  tarball manifest, public type, and example validation.
- Align the default and CI browser matrix on Chromium and WebKit.
- Add repeatable request pipeline benchmarks with throughput, latency,
  memory observations, and CI JSON artifacts.
- Cache interceptor and plugin-hook order at registration time and skip empty
  async pipeline stages on the common request path.
- Avoid absent nested config allocations and normalize merged headers in one
  pass while preserving case-insensitive overrides and default isolation.
- Reuse the Pipeline's final validated Headers for the first FetchAdapter
  attempt while retaining standalone and retry validation.
- Skip Fetch Response cloning for successful data-only requests while
  preserving raw bodies for complete responses, extensions, and HTTP errors.
- Reduce request-construction allocations for body validation, URL joining,
  query parameters, forms, and FormData records.
