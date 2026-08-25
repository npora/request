---
'@npora/request': patch
---

Honor response Cache-Control freshness conservatively in the cache plugin.
Valid `max-age` and `Age` values cap the configured TTL, while `no-cache`
responses without validators, invalid or repeated `max-age`, `no-store`, and
`Vary: *` responses are not persisted. Concurrent in-flight deduplication
remains available.
