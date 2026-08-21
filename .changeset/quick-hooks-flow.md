---
"@npora/request": patch
---

Dispatch single plugin hooks directly so synchronous hooks skip generic iteration and asynchronous hooks avoid an empty recursive continuation.
