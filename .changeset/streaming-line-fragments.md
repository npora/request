---
"@npora/request": patch
---

Parse fragmented SSE and NDJSON lines without repeatedly copying or scanning
the unfinished prefix. Preserve UTF-8 decoding, CR/LF/CRLF handling, streaming
backpressure, and cancellation. Add a reproducible long-line benchmark.
