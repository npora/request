---
'@npora/request': minor
---

Add a read-through, write-through tiered cache that preserves synchronous
primary hits, promotes secondary results, commits durable writes first, and
coordinates deletion, clearing, tag invalidation, and partial failures across
both stores.
