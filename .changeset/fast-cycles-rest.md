---
"@npora/request": patch
---

Reduce synchronous interceptor, plugin-hook, cache-store, bounded-response,
timeout setup, request validation, body-merge, concurrency admission, and
circuit-breaker settlement overhead. Avoid Promise chains for synchronous
authentication token providers, storage, retry policies, delay functions,
jitter functions, and zero-delay retries. Reuse normalized retry options for
each logical request, and skip response-schema validation setup when no schema
is configured. Keep synchronous response processing and fully synchronous
plugin hook chains on the synchronous path while preserving asynchronous
continuation and hook ordering. Keep error notification and final failure on
the synchronous path until an asynchronous hook or interceptor requires a
continuation. Detect body configuration through own fields without duplicate
value probes on body-free requests. Dispatch requests without hooks,
interceptors, or schemas directly after validation without allocating lifecycle
context or timestamps. Avoid
allocating observer Promises for synchronous logger, retry, and circuit-breaker
callbacks. Resolve Fetch response types once and avoid double-wrapping bounded
data-only response streams. Keep synchronous memory-cache reads, writes,
deletions, hits, and miss registration off the asynchronous hook path, and
reuse immutable primitive cache values without structured cloning. Keep
non-refreshing authentication errors and synchronous refresh policy decisions
off the asynchronous retry path. Merge query and body configuration directly
into the request result without temporary objects. Normalize cache vary-header
names once, avoid per-request Map allocation while creating cache keys, and
reuse empty vary-header metadata for headerless requests. Reuse the registered
deduplication key when persisting or discarding a cache miss response instead
of serializing the same request identity twice. Skip transient response
snapshots for non-persistent cache misses unless a concurrent follower needs
the result, and allocate the shared completion Promise only when the first
follower arrives.
Rely on native ES2020 error subclassing instead of repairing the request-error
prototype on every failure. Avoid exception-driven origin resolution for
relative concurrency and circuit-breaker request URLs, and reuse the last exact
successful origin parse for repeated plugin isolation checks.
Preserve the stable response-size error when cancellation of an oversized
stream also fails.
