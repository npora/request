---
"@npora/request": patch
---

Bypass general configuration merging for method shortcuts without client or
request options, and reuse the native own-property intrinsic across request
configuration and serialization hot paths.
