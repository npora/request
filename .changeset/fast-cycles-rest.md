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
callbacks.
Preserve the stable response-size error when cancellation of an oversized
stream also fails.
