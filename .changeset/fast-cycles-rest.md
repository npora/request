---
"@npora/request": patch
---

Reduce synchronous interceptor, plugin-hook, cache-store, bounded-response,
timeout setup, request validation, body-merge, concurrency admission, and
circuit-breaker settlement overhead. Avoid Promise chains for synchronous
authentication token providers, storage, retry policies, delay functions,
jitter functions, and zero-delay retries. Reuse normalized retry options for
each logical request, and skip response-schema validation setup when no schema
is configured. Keep fully synchronous plugin hook chains on the synchronous
path while preserving asynchronous continuation and hook ordering. Avoid
allocating observer Promises for synchronous logger, retry, and circuit-breaker
callbacks. Resolve Fetch response types once and avoid double-wrapping bounded
data-only response streams. Keep synchronous memory-cache reads, writes,
deletions, hits, and miss registration off the asynchronous hook path. Keep
non-refreshing authentication errors and synchronous refresh policy decisions
off the asynchronous retry path. Merge query and body configuration directly
into the request result without temporary objects. Normalize cache vary-header
names once and avoid per-request Map allocation while creating cache keys.
Rely on native ES2020 error subclassing instead of repairing the request-error
prototype on every failure.
Preserve the stable response-size error when cancellation of an oversized
stream also fails.
