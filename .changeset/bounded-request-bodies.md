---
'@npora/request': minor
---

Add `maxRequestSize` preflight enforcement for deterministically sized JSON,
text, URLSearchParams, Blob, ArrayBuffer, and typed-array request bodies across
the built-in Fetch and XHR transports. Oversized requests fail before dispatch
with the stable `REQUEST_TOO_LARGE` error code.
