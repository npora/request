---
"@npora/request": patch
---

Reduce synchronous interceptor and plugin-hook overhead, avoid timeout setup
work when no timeout is active, and remove a request-body merge allocation.
