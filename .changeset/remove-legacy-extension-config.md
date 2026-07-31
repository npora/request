---
"@npora/request": minor
---

Remove the deprecated top-level retry, cache, auth, logger, upload, and
download request fields. Plugin-owned configuration must now be provided under
the namespaced `extensions` field, keeping business options out of the stable
Core request contract.
