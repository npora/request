---
'@npora/request': minor
---

Add bounded stale-if-error recovery to the cache plugin. Response
`stale-if-error` directives and the request `staleIfError` limit may recover
network, timeout, and 5xx failures after retries are exhausted without hiding
abort, parsing, configuration, schema, or non-5xx errors.
