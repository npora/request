---
"@npora/request": patch
---

Retain half-open probe capacity until asynchronous failure classification settles, preventing slow custom failure policies from admitting more probes than halfOpenMaxRequests while still releasing capacity after false results or rejected classifiers.
