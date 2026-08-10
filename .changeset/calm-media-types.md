---
'@npora/request': patch
---

Normalize response media types case-insensitively and require exact or
structured-suffix matches before selecting JSON, SSE, or NDJSON parsing. This
also completes the README streaming-method inventory and clarifies streaming
resource lifetime.
