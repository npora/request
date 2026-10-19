---
"@npora/request": patch
---

Prevent pending authentication refreshes from starting token-storage writes
after all participating plugin installations are removed. Reinstallations start
an independent refresh, while other active participants retain shared refresh
and single-write behavior.
