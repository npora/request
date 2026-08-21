---
"@npora/request": patch
---

Reduce synchronous interceptor, plugin-hook, cache-store, bounded-response,
timeout setup, request validation, and body-merge overhead.
Preserve the stable response-size error when cancellation of an oversized
stream also fails.
