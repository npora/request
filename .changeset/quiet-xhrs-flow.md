---
"@npora/request": patch
---

Avoid teeing data-only XHR response bodies, and parse buffered JSON, text, Blob, and ArrayBuffer values directly from the native XHR Blob while preserving limits, MIME types, parser errors, and readable raw bodies when required.
