---
'@npora/request': patch
---

Conditionally revalidate stale cache entries with `ETag` and `Last-Modified`.
Successful `304 Not Modified` responses reuse the cached entity, merge updated
metadata, and refresh the entry lifetime without overriding application-owned
conditional or range request headers.
