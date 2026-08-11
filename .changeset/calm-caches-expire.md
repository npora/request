---
"@npora/request": patch
---

Preserve cache entries configured with an infinite TTL, reject invalid TTL
values before sending a request, and make integration-test cleanup safe when
the local test server cannot start.
