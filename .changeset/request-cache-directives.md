---
'@npora/request': patch
---

Honor request cache directives in the cache plugin. `no-cache`, `max-age=0`,
and legacy `Pragma: no-cache` force revalidation, while request `no-store`
bypasses cache reads, writes, and in-flight deduplication without replacing an
existing entry.
