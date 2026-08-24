---
"@npora/request": patch
---

Isolate cache generations across clear calls so stale asynchronous reads and requests started before clearing cannot serve, overwrite or delete entries created afterward, while existing deduplicated followers still settle normally.
