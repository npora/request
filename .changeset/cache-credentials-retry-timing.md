---
"@npora/request": patch
---

Isolate full-cache entries by effective Fetch credential mode and bypass caching for integrity and non-follow redirect constraints. Stop retries when server-provided retry delays exceed maxDelay instead of retrying before the requested time.
