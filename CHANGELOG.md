# @npora/request

## 1.14.2

### Patch Changes

- 3f3d004: Reduce synchronous interceptor, plugin-hook, cache-store, bounded-response,
  timeout setup, request validation, body-merge, concurrency admission, and
  circuit-breaker settlement overhead. Avoid Promise chains for synchronous
  authentication token providers, storage, retry policies, delay functions,
  jitter functions, and zero-delay retries. Apply configured static tokens
  directly when no request-level authentication override is present, and create
  bare static authorization headers without an intermediate Headers instance.
  Reuse normalized retry options for each logical request, and skip
  response-schema validation setup when no schema is configured. Keep
  synchronous response processing and fully
  synchronous plugin hook chains on the synchronous path while preserving
  asynchronous continuation and hook ordering. Keep error notification and final
  failure on the synchronous path until an asynchronous hook or interceptor
  requires a continuation. Detect body configuration through own fields without
  duplicate value probes on body-free requests. Dispatch requests without hooks,
  interceptors, or schemas directly after validation without allocating lifecycle
  context or timestamps. Avoid
  allocating observer Promises for synchronous logger, retry, and circuit-breaker
  callbacks, and reuse logger URL redaction across lifecycle entries while the
  effective URL is unchanged. Iterate sensitive query keys directly without a
  temporary key array. Resolve Fetch response types once and avoid
  double-wrapping bounded data-only response streams. Keep synchronous
  memory-cache reads, writes,
  deletions, hits, and miss registration off the asynchronous hook path, and
  reuse immutable primitive cache values without structured cloning. Avoid
  rewriting the in-memory LRU order when the requested entry is already newest.
  Skip clock reads for permanent cache entries, and reuse empty normalized query
  metadata while generating headerless cache keys. Reuse the last exact automatic
  cache key for repeated requests without headers or query parameters.
  Clone single-sided extension configuration directly, reserving per-plugin deep
  merge scans for requests that actually combine default and request extensions.
  Detect missing, plain-text, and JSON response media types without normalization
  work while retaining strict handling for parameters and structured suffixes.
  Skip materializing empty validated headers for custom adapters that do not
  consume the built-in validated-header fast path.
  Keep non-refreshing authentication errors and synchronous refresh policy
  decisions off the asynchronous retry path. Merge query and body configuration
  directly into the request result without temporary objects. Normalize cache
  vary-header names once, avoid per-request Map allocation while creating cache
  keys, and
  reuse empty vary-header metadata for headerless requests. Reuse the registered
  deduplication key when persisting or discarding a cache miss response instead
  of serializing the same request identity twice. Skip transient response
  snapshots for non-persistent cache misses unless a concurrent follower needs
  the result, and allocate the shared completion Promise only when the first
  follower arrives. Reuse concurrency isolation records as admission state and
  refresh their retention order only when they become inactive, avoiding a
  temporary admission object and redundant Map writes on successful requests.
  Return hook-free adapter Promises directly, merge method-shortcut configuration
  once, and keep synchronous interceptors on the synchronous lifecycle path until
  a Promise requires continuation. Validate request methods and response types by
  direct branching, and skip retry event and elapsed-time bookkeeping when no
  jitter, elapsed-time budget, or retry observer needs it.
  Rely on native ES2020 error subclassing instead of repairing the request-error
  prototype on every failure. Avoid exception-driven origin resolution for
  relative concurrency and circuit-breaker request URLs, and reuse the last exact
  successful origin parse for repeated plugin isolation checks.
  Preserve the stable response-size error when cancellation of an oversized
  stream also fails.
  Enable Fetch half-duplex mode for `ReadableStream` request bodies so Node
  runtimes can send streaming uploads without caller-supplied transport options.
  Delay timeout allocation until synchronous request serialization succeeds,
  preventing timers and abort listeners from surviving configuration failures.
  Register external abort listeners before allocating timeout timers, avoiding
  timer churn for pre-aborted signals and leaks when listener setup fails.
  Reject request timeouts beyond the platform timer range instead of allowing
  Node to overflow them into an immediate timeout.
  Cap retry and concurrency queue delays at the same platform limit, including
  delays returned by custom retry hooks, so oversized waits cannot wrap to 1ms.
  Register abort listeners before retaining retry timers or concurrency queue
  entries, preventing resource leaks when listener setup fails.
  Parse Retry-After delay seconds as decimal digits only and reject date formats
  without an HTTP weekday prefix, falling back to the configured retry delay for
  invalid negative, fractional, ISO, or month-name date values.
  Reuse pre-aborted external signals without allocating a timeout controller,
  listener, timer, or cleanup closure.
  Short-circuit pre-aborted Fetch requests before body serialization and network
  dispatch, and share abort error conversion with XHR to remove duplicate code.
  Enforce the same cancellation gate at the shared transport boundary so XHR,
  Mock, and custom adapters are skipped before serialization or setup work.
  Avoid response-type detection, parsing, and cloning for HEAD, 204, 205, and 304
  Fetch and XHR results, and share their bodyless-status classification across
  transports.

## 1.14.1

### Patch Changes

- 14f850e: Minify the published ESM and CommonJS entrypoints and lower the enforced
  package-size budgets, reducing the JavaScript and unpacked package footprint
  without changing runtime exports, exported constructor names, type
  declarations, or documented behavior.

## 1.14.0

### Minor Changes

- f67b1ce: Add backpressure-aware download stream output through
  `extensions.download.output: 'stream'`. Stream downloads report progress as
  the consumer reads, propagate cancellation to the response body, preserve
  response-size enforcement, and reject unsupported XHR combinations before
  network I/O.

## 1.13.0

### Minor Changes

- eb885ec: Add per-event byte deltas, average transfer rate, and estimated remaining time
  to upload and download progress callbacks while preserving the existing
  loaded, total, and progress fields. Fetch-stream downloads now also report an
  empty transfer exactly once.

## 1.12.0

### Minor Changes

- d34d3c9: Run alternative plugin transports inside each retry attempt so upload and
  download progress requests preserve retry, authentication refresh, circuit
  breaker, concurrency, cache, response, and settled lifecycle behavior.

  Add a complete configuration reference covering core parameters, plugin
  extensions, defaults, merge rules, transfer progress semantics, memory limits,
  and Fetch options that XMLHttpRequest cannot preserve.

## 1.11.1

### Patch Changes

- 35a91e7: Reject unsupported HTTP methods before custom adapters run, and accept native
  `URLSearchParams` values created by another browser realm without weakening
  runtime configuration validation.

## 1.11.0

### Minor Changes

- 5f5637a: Add native URLSearchParams query input through `searchParams`, with exact
  repeated-key, ordering and encoding preservation across Fetch, XHR, caching
  and MockAdapter matching.

## 1.10.3

### Patch Changes

- 414dec3: Reject invalid response types and status validators as configuration errors
  before starting network I/O.

## 1.10.2

### Patch Changes

- 26fa3f5: Expire cache entries at their exact TTL boundary, preserve HTTP error handling
  for bodyless 304 responses, classify failing validateStatus callbacks as
  configuration errors, reduce duplicate plugin origin-resolution code, and omit
  documentation comments from runtime bundles.

## 1.10.1

### Patch Changes

- cdd39a3: Preserve cache entries configured with an infinite TTL, reject invalid TTL
  values before sending a request, and make integration-test cleanup safe when
  the local test server cannot start.

## 1.10.0

### Minor Changes

- f5fd0bd: Add zero-dependency Standard Schema v1 response validation with automatic
  output type inference, synchronous and asynchronous validator support,
  transformed response data, and a unified `SchemaValidationError` carrying the
  stable `SCHEMA_ERROR` code, issues, schema vendor, parsed data, and response
  metadata.

## 1.9.1

### Patch Changes

- 8ccc6c5: Normalize response media types case-insensitively and require exact or
  structured-suffix matches before selecting JSON, SSE, or NDJSON parsing. This
  also completes the README streaming-method inventory and clarifies streaming
  resource lifetime.

## 1.9.0

### Minor Changes

- 95d3453: Add first-class streaming parsers for server-sent events and newline-delimited
  JSON. The new `sse` and `ndjson` response types expose lazy async iterables,
  support content-type detection, cancel readers when iteration ends early, and
  preserve timeout, cancellation, and response-size enforcement while streaming.
  Streaming responses bypass cache persistence and unsafe iterator sharing.

## 1.8.0

### Minor Changes

- 3ffcf0b: Add browser-focused response-size limits and FormData nesting protection.
  Prevent the cache plugin from persisting responses marked with
  `Cache-Control: no-store` or `Vary: *`, and isolate cached variants using all
  explicitly configured request headers while retaining safe in-flight request
  deduplication.

## 1.7.0

### Minor Changes

- 87eb63d: Add an origin-isolated concurrency plugin with FIFO queueing, bounded active,
  queued and retained state, per-request queue timeouts and cancellation-aware
  cleanup.

## 1.6.0

### Minor Changes

- edd4c9a: Bound the built-in memory cache and circuit-breaker state with configurable
  LRU eviction while preserving active circuit records until requests settle.

## 1.5.0

### Minor Changes

- 98f6189: Add a circuit-breaker plugin with origin isolation, bounded half-open probes,
  final-outcome failure accounting, state observers, and manual reset controls.

## 1.4.0

### Minor Changes

- a141b47: Expand MockAdapter with method-aware matching, rich and one-time responses,
  delay and error simulation, and request history controls.

## 1.3.0

### Minor Changes

- 03a36a1: Add pluggable cache stores, concurrent request deduplication, and a final
  settled plugin lifecycle hook.

## 1.2.0

### Minor Changes

- e10a4e5: Add retry jitter, total elapsed-time budgets, and structured retry lifecycle
  callbacks.

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
