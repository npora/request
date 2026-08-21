---
"@npora/request": patch
---

Reduce synchronous interceptor, plugin-hook, cache-store, bounded-response,
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
