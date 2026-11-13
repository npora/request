---
'@npora/request': minor
---

Preserve SSE/NDJSON cancellation with stream metrics, coordinate asynchronous cache writes and invalidation, prevent stale IndexedDB admissions and tiered promotions after invalidation, reject native Request streams before XHR dispatch, remove cache-owned validators when authentication changes, and align tracing URL paths with transport URLs.

Add cachePlugin statusCodes to explicitly select persistable HTTP statuses. Persistence defaults to 200–299 except 206, independently of throwHttpErrors or validateStatus; HTTP cache directives continue to apply.
