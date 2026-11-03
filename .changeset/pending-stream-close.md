---
"@npora/request": patch
---

Closing an SSE or NDJSON iterator now interrupts pending reads and asynchronous
item validation, including SSE reconnect waits and connections. Pending reads
finish without delivering more items, return values and thrown reasons are
preserved, and request resources are released without aborting the caller's signal.
