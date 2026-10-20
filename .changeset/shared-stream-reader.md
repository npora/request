---
"@npora/request": patch
---

Enforce Fetch stream size limits in the same reader wrapper that owns abort and
timeout cleanup, avoiding repeated wrapping of stream, SSE, and NDJSON responses.
Preserve cancellation, size errors, response metadata, and buffered parsing.
