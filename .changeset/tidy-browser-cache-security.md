---
'@npora/request': minor
---

Add browser-focused response-size limits and FormData nesting protection.
Prevent the cache plugin from persisting responses marked with
`Cache-Control: no-store` or `Vary: *`, and isolate cached variants using all
explicitly configured request headers while retaining safe in-flight request
deduplication.
