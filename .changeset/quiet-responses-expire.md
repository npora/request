---
"@npora/request": patch
---

Expire cache entries at their exact TTL boundary, preserve HTTP error handling
for bodyless 304 responses, classify failing validateStatus callbacks as
configuration errors, reduce duplicate plugin origin-resolution code, and omit
documentation comments from runtime bundles.
