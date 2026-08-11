---
'@npora/request': patch
---

Reject unsupported HTTP methods before custom adapters run, and accept native
`URLSearchParams` values created by another browser realm without weakening
runtime configuration validation.
