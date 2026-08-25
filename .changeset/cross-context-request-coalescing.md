---
'@npora/request': minor
---

Add optional Web Locks coordination to `TieredCacheStore` so independent
same-origin clients can coalesce cache misses and revalidations through a
shared secondary cache.
