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
