---
"@npora/request": patch
---

Make asynchronous initial authentication token resolution, cache-store reads and writes, retry decisions, and circuit-breaker failure classification observe each request's AbortSignal without retaining listeners, retry work, or half-open probe permits.
