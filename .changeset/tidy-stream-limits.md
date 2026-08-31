---
'@npora/request': minor
---

Enforce `maxRequestSize` incrementally for Fetch `ReadableStream` uploads,
preserving backpressure and cancelling the source when the limit is exceeded.
