---
"@npora/request": patch
---

Skip native stream brand checks for primitive request bodies. This avoids
exception construction on ordinary JSON requests while preserving native and
cross-realm stream detection.
