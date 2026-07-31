# @npora/request

## 1.1.0

### Minor Changes

- 3c36295: Add injectable structured logging with request identifiers, timestamps,
  durations, and retry attempt metadata.

## 1.0.1

### Patch Changes

- 985adff: Redact credentials embedded in absolute and protocol-relative URLs before the
  logger emits request, response, or error metadata.

  Add dedicated security regressions, dependency and package-signature audits,
  CodeQL analysis, Dependabot maintenance, scheduled clean-install verification
  of the published package, and a rewritten 1.x documentation set covering
  architecture, migration, security, testing, contribution, and vulnerability
  reporting.

## 1.0.0

### Major Changes

- 06d348e: Release the stable 1.0 public API.

  The package now guarantees its documented package-root exports, TypeScript
  declarations, client and response behavior, stable error codes, plugin
  lifecycle, and namespaced extension configuration under Semantic Versioning.

  The 1.0 release is verified across Node.js 22, 24 and 26, Chromium and WebKit,
  ES modules and CommonJS, package-consumer type checks, exact API export
  contracts, black-box behavior compatibility tests, coverage thresholds, and
  distribution size budgets.

## 0.5.0

### Minor Changes

- e715268: Remove the undocumented global `clearCache()` export. Cache stores are isolated
  per plugin instance and should be invalidated through the `clear()` method on
  the value returned by `cachePlugin()`.

  Add an exact package export contract so accidental runtime or type exports are
  caught before the public API is frozen for 1.0.

## 0.4.0

### Minor Changes

- 0fe9456: Remove the deprecated top-level retry, cache, auth, logger, upload, and
  download request fields. Plugin-owned configuration must now be provided under
  the namespaced `extensions` field, keeping business options out of the stable
  Core request contract.

## 0.3.0

### Minor Changes

- b704848: Require supported Node.js 22 or newer releases and verify Node.js 22, 24, and
  26 in CI. Document the Fetch Adapter as the shared browser, worker, and Node.js
  transport instead of maintaining a redundant Node-only adapter.

## 0.2.1

### Patch Changes

- 769e51e: Automate npm publishing, Git tags, and GitHub Releases through Changesets.

## 0.2.0

### Minor Changes

- 6499017: Add a production-ready request lifecycle and extension API.

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
  - Enforce raw, gzip, declaration, and npm tarball size budgets in package,
    release, and CI verification with machine-readable reports.
  - Evaluate Axios and nine representative GitHub request libraries with
    equivalent rotating local HTTP workloads, then remove every competitor
    dependency and document the resulting architecture decisions.

### Patch Changes

- 88a30a6: add cross-browser compatibility tests

## 0.1.1

### Patch Changes

- b193928: prepare initial public release
