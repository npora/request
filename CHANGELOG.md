# @npora/request

## 1.17.1

### Patch Changes

- 77b3858: Prevent body-bearing requests from using automatic cache keys that omit the
  body, preserve explicitly null error data, reject malformed structured request
  options, prevent inherited plugin defaults from entering request overrides,
  reuse trailing URL query delimiters, reduce native Request reuse allocations,
  snapshot sanitized client defaults to avoid repeated ownership probes, accept
  pnpm's leading benchmark argument delimiter, skip body ownership probes for
  known body-free client defaults, bound latency sampling in the core and real
  HTTP benchmark runners, avoid exception-driven native Request detection for
  plain request configs, remove the direct request API's redundant async wrapper,
  add an origin-isolated rolling-window request rate limiter, validate and
  transform individual SSE and NDJSON items lazily with Standard Schema, and
  add dependency-free OpenTelemetry client spans and trace-context propagation,
  coordinate origin-scoped 429 Retry-After cooldowns, add dependency-free
  OpenTelemetry request metrics, validate two million schema-backed stream items
  under backpressure, emit decoded stream lines without per-chunk line arrays,
  make cache/retry metrics reflect actual plugin and transport outcomes, enforce
  relative request plus throughput, checksum, slow-consumer and heap CI budgets,
  measure complete byte-stream, NDJSON, and SSE consumption outcomes and duration,
  guard the non-streaming Metrics fast path against regression,
  and strengthen type and release verification.

## 1.17.0

### Minor Changes

- 55f1eb3: Accept native and cross-realm `Request` inputs in `request()` and
  `requestResponse()`, with client defaults and explicit per-call overrides.
- e23e6cc: Support the RFC 10008 QUERY method with typed data and response shortcuts,
  content-bearing requests, and safe default retries for replayable bodies.
- b435a41: Enforce `maxRequestSize` incrementally for Fetch `ReadableStream` uploads,
  preserving backpressure and cancelling the source when the limit is exceeded.

### Patch Changes

- 4d37de0: Consume Fetch HTTP error bodies once while populating bounded error data instead
  of retaining a separately readable cloned stream, preventing ignored errors
  from buffering an unread response branch while preserving native metadata.

## 1.16.0

### Minor Changes

- Add inheritable `parseJson` and `stringifyJson` options for custom buffered
  JSON decoding and request-body encoding across Fetch and XHR transports.
- Add portable `bytes` response parsing that returns `Uint8Array` across native
  Fetch, bounded reads, and XHR transports.
- Add `removeHeaders` for case-insensitive removal of inherited defaults without
  widening the standard `HeadersInit` contract. Preserve native `Headers` created
  by another JavaScript realm while merging client defaults.
- Pass the final request configuration and native response metadata to custom
  JSON parsers across Fetch, XHR, bounded, and HTTP-error response paths.
- Add shallow-merged local request context that remains available across
  interceptors, plugins, parsers, responses, retries, and errors.
- Add an inheritable `querySerializer` option for backend-specific object query
  formats with strict validation and explicit cache-key isolation.
- Add explicit FormData response parsing across Fetch and XHR transports with
  response-size enforcement and cache-safe behavior.
- Add declarative retry status codes, independent timeout retry control, and
  default-policy fallback from custom retry decisions.
- Accept native and cross-realm URL request inputs across direct and method APIs,
  snapshot them before asynchronous lifecycle work, and preserve URL boundary,
  cache, origin isolation, and log-redaction behavior.
- Add a Fetch-compatible `fetch` configuration option that can be inherited by a
  client and overridden per request while retaining the built-in adapter's full
  validation, timeout, retry, parsing, streaming, and error lifecycle.
- Honor standard and common rate-limit retry timing headers, including reset
  timestamps, and retry HTTP 413 only when the server supplies valid timing.
- Add `throwHttpErrors: false` for parsed, non-throwing HTTP error responses
  across Fetch, XHR, and MockAdapter while preserving non-HTTP error handling and
  explicit `validateStatus` policies.
- Add cross-realm `isRequestError` and `isSchemaValidationError` type guards and
  use shared non-enumerable error brands throughout transports and plugins so
  duplicated package instances preserve stable error classification.
- Add an overall `totalTimeout` deadline that covers hooks, retries, delays,
  response processing, and stream consumption independently from each attempt's
  `timeout`.
- Allow complete JSON root values, including primitives and explicit null, in
  the JSON request-body shortcut with consistent merging and validation.
- Negotiate response media types with an automatic `Accept` header for explicit
  JSON, text, FormData, binary, stream, SSE, and NDJSON response modes while
  preserving caller-provided headers.

### Patch Changes

- Bound HTTP error-body reads and asynchronous JSON parsing by the configured
  timeout or a 10-second fallback, cancel stalled Fetch readers, preserve
  HTTP_ERROR when only the fallback expires, and keep explicit timeout,
  total-timeout, and external-abort classification authoritative across Fetch
  and XHR.
- Align the default retry policy with its documented contract by retrying request
  timeouts and HTTP 425 responses for replayable methods. Close an abort race in
  timeout signal composition, and make `RequestError` JSON serialization exclude
  request configuration, response data, and causes that may contain secrets.
- Limit buffered data attached to HTTP errors to 10 MiB by default across Fetch
  and XHR, add `maxErrorResponseSize` with an `Infinity` opt-out, avoid cloning
  Fetch bodies known to exceed the limit, and preserve stricter explicit
  `maxResponseSize` failures.
- Preserve HTTP_ERROR with undefined data when rejected Fetch or XHR response
  payload parsing fails, while keeping successful and explicitly non-throwing
  responses strict and leaving timeout, abort, and hard size errors authoritative.
- Handle native opaque and manual-redirect Fetch responses without false HTTP or
  parser failures, while isolating unreadable responses from cache reuse and
  preserving explicit status validation.
- Compose `baseURL` path prefixes safely when base and request URLs contain query
  strings, fragments, or suffix-only references while preserving established
  absolute-URL and security-boundary behavior.
- Recognize native FormData, Blob, ArrayBuffer, and ReadableStream request bodies
  across JavaScript realms with non-consuming platform brand checks, preserving
  multipart data, size limits, Fetch duplex setup, XHR rejection, retry safety,
  mock responses, streaming timeout cleanup, and cache size estimation.

## 1.15.1

### Patch Changes

- 03bd239: Remove public competitor comparisons and rankings from the Markdown
  documentation while retaining product-focused capabilities, reproducible
  first-party benchmarks, and practical migration guidance.

## 1.15.0

### Minor Changes

- 05e65d7: Add automatic cache-tag invalidation after successful requests, with final
  retry outcome accounting, failure preservation, custom-store preflight checks,
  and awaited asynchronous invalidation.
- 05e65d7: Add `maxRequestSize` preflight enforcement for deterministically sized JSON,
  text, URLSearchParams, Blob, ArrayBuffer, and typed-array request bodies across
  the built-in Fetch and XHR transports. Oversized requests fail before dispatch
  with the stable `REQUEST_TOO_LARGE` error code.
- 05e65d7: Add privacy-safe cache observability with aggregate statistics, reset support,
  and isolated lifecycle event callbacks for cache decisions and background
  refresh outcomes.
- 05e65d7: Add bounded cache tags and grouped invalidation with default memory-store
  support, optional custom-store integration, asynchronous coordination, and
  in-flight generation isolation.
- 05e65d7: Add privacy-safe BroadcastChannel invalidation to tiered caches, including
  bounded key fingerprint tracking, remote primary eviction, broad fallback for
  unknown keys and tags, listener disposal, and partial-write recovery.
- 05e65d7: Add optional Web Locks coordination to `TieredCacheStore` so independent
  same-origin clients can coalesce cache misses and revalidations through a
  shared secondary cache.
- 05e65d7: Add approximate byte-budget LRU eviction and scoped quota-exceeded recovery to
  the IndexedDB cache store.
- 05e65d7: Add synchronous and asynchronous admission policies to the IndexedDB cache
  store for selectively excluding persistent entries.
- 05e65d7: Add bounded IndexedDB cache compaction and cursor-based constant-memory usage
  inspection with privacy-safe expired-entry events.
- 05e65d7: Add aggregate usage inspection and privacy-safe lifecycle events to the
  IndexedDB cache store.
- 05e65d7: Add an asynchronous, namespaced IndexedDB cache with structured-clone data,
  bounded LRU eviction, tag invalidation, scoped clearing, malformed-record
  recovery, connection cleanup, and safe native Response omission.
- 05e65d7: Add monotonic IndexedDB cache schema versions with backward-compatible version
  1 records, rolling-deployment isolation, and automatic pruning of older data.
- 05e65d7: Add tree-shakeable ESM and CommonJS subpath exports for the core client,
  aggregate and individual official plugins, and MockAdapter testing utilities.
  Keep the root entry point backward compatible while sharing internal chunks so
  constructors and errors retain identity across entry points.
- 05e65d7: Add programmatic cache seeding and functional updates with effective-key
  matching, asynchronous store serialization, tag support, defensive value
  cloning, raw-response invalidation, and stale in-flight write isolation.
- 05e65d7: Add `allowAbsoluteUrls` so clients can prevent absolute request URLs from
  bypassing a configured `baseURL`, including URLs introduced by lifecycle
  extensions. Serialize `null` query and form values as empty values while
  continuing to omit `undefined`, matching the documented request contract.
- 05e65d7: Add bounded stale-if-error recovery to the cache plugin. Response
  `stale-if-error` directives and the request `staleIfError` limit may recover
  network, timeout, and 5xx failures after retries are exhausted without hiding
  abort, parsing, configuration, schema, or non-5xx errors.
- 05e65d7: Add stale-while-revalidate caching with response directive and request-level
  window support. Eligible stale entries return immediately while one abortable,
  deduplicated refresh runs through the owning client pipeline in the background.
- 05e65d7: Add targeted cache deletion by effective request configuration, including
  per-key in-flight generation isolation, asynchronous store coordination,
  background refresh cancellation, and invalidation observability.
- 05e65d7: Add a read-through, write-through tiered cache that preserves synchronous
  primary hits, promotes secondary results, commits durable writes first, and
  coordinates deletion, clearing, tag invalidation, and partial failures across
  both stores.
- 05e65d7: Add a namespaced Web Storage cache with JSON persistence, bounded LRU eviction,
  tag invalidation, scoped clearing, corrupt-record recovery, and safe raw
  response omission for localStorage and sessionStorage.

### Patch Changes

- 05e65d7: Conditionally revalidate stale cache entries with `ETag` and `Last-Modified`.
  Successful `304 Not Modified` responses reuse the cached entity, merge updated
  metadata, and refresh the entry lifetime without overriding application-owned
  conditional or range request headers.
- 05e65d7: Honor response Cache-Control freshness conservatively in the cache plugin.
  Valid `max-age` and `Age` values cap the configured TTL, while `no-cache`
  responses without validators, invalid or repeated `max-age`, `no-store`, and
  `Vary: *` responses are not persisted. Concurrent in-flight deduplication
  remains available.
- 05e65d7: Preserve every higher-version IndexedDB cache record without interpreting its
  envelope, abort failed cursor maintenance transactions safely, and make LRU
  eviction deterministic when access timestamps are equal.
- 05e65d7: Honor request cache directives in the cache plugin. `no-cache`, `max-age=0`,
  and legacy `Pragma: no-cache` force revalidation, while request `no-store`
  bypasses cache reads, writes, and in-flight deduplication without replacing an
  existing entry.

## 1.14.4

### Patch Changes

- b931ff2: Make asynchronous initial authentication token resolution, cache-store reads and writes, retry decisions, and circuit-breaker failure classification observe each request's AbortSignal without retaining listeners, retry work, or half-open probe permits.
- b931ff2: Make asynchronous refresh-policy, shared token-refresh and post-refresh token waits abortable per request without cancelling the shared refresh, and prevent removed auth plugins from retrying requests that were already waiting.
- b931ff2: Isolate cache generations across clear calls so stale asynchronous reads and requests started before clearing cannot serve, overwrite or delete entries created afterward, while existing deduplicated followers still settle normally.
- b931ff2: Avoid retaining duplicate raw response bodies for data-only cache entries while preserving independent raw bodies for complete responses and raw-response hooks.
- b931ff2: Prevent data-only cache entries and in-flight leaders from serving complete-response callers without a readable raw body, deduplicate those callers through a raw-capable leader, and continue allowing complete leaders to serve data-only followers.
- b931ff2: Retain half-open probe capacity until asynchronous failure classification settles, preventing slow custom failure policies from admitting more probes than halfOpenMaxRequests while still releasing capacity after false results or rejected classifiers.
- b931ff2: Avoid teeing data-only XHR response bodies, and parse buffered JSON, text, Blob, and ArrayBuffer values directly from the native XHR Blob while preserving limits, MIME types, parser errors, and readable raw bodies when required.
- b931ff2: Avoid retaining per-request retry option state when a request uses the plugin defaults.
- b931ff2: Reject non-string `baseURL` values and malformed HTTP(S) `url` or `baseURL`
  forms before adapter dispatch, preventing runtime-dependent URL normalization
  from changing the intended request target. Ignore inherited values while
  merging configuration and reject reserved request fields supplied through a
  prototype chain before adapters or plugins can consume them.
  
  Prevent timeout allocation when a custom external signal aborts synchronously
  during listener registration, and cancel streaming response readers if abort
  listener setup fails so request cleanup cannot be deferred indefinitely.
  
  Avoid retaining retry timers or concurrency queue entries when custom abort
  signals fire synchronously during listener registration, and keep permit
  handoff progressing when listener removal throws.
  
  Replace the concurrency wait array with a constant-time FIFO queue so permit
  handoff, cancellation, timeout, and plugin removal do not degrade as queue
  depth grows.
  
  Make cache-deduplication followers settle idempotently when abort registration
  fires synchronously or listener cleanup fails, without retaining a subscription
  to the shared request after cancellation.
  
  Prevent XMLHttpRequest transports from sending after synchronous abort
  registration, and keep XHR settlement progressing when abort-listener cleanup
  throws.
  
  Make delayed MockAdapter responses roll back listener and timer setup safely,
  including synchronous abort registration and listener-cleanup failures.
  
  Roll back timeout-signal listener registration when listener or timer setup
  throws, and clear handles returned by synchronously firing custom timers.
  
  Apply the same transactional setup to retry delays so listener and timer
  initialization failures cannot retain cancellation resources.
  
  Avoid redundant circuit-breaker Map delete/set operations when consecutive
  requests use the same isolation key while preserving LRU refresh on key
  changes.

## 1.14.3

### Patch Changes

- e8fd170: Bypass general configuration merging for method shortcuts without client or
  request options, and reuse the native own-property intrinsic across request
  configuration and serialization hot paths.
- e8fd170: Reduce request configuration merge work by inheriting default body modes directly and clearing them only when the request supplies an explicit body mode.
- e8fd170: Reduce validation overhead for valid request bodies by reserving body-mode collection work for conflicting configurations.
- e8fd170: Reduce query, Fetch option, and single-sided header merge overhead by removing duplicate empty-input checks from internal merge helpers.
- e8fd170: Dispatch single plugin hooks directly so synchronous hooks skip generic iteration and asynchronous hooks avoid an empty recursive continuation.

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
