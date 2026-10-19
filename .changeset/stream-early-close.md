---
"@npora/request": patch
---

Release SSE and NDJSON response bodies when their iterator is returned or
thrown into before its first read. Close initial SSE reconnect responses and
clear per-attempt and total timeout resources without consuming stream items
or reconnecting. Preserve normal iterator completion and consumer errors.
