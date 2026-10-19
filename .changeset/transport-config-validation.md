---
"@npora/request": patch
---

Revalidate final request configuration and headers after transport hooks fall
through to the configured adapter. Apply header mutations consistently on first
attempts and retries, and reject invalid or cancelled requests before dispatch
to custom adapters.
