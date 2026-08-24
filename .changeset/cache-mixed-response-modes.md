---
"@npora/request": patch
---

Prevent data-only cache entries and in-flight leaders from serving complete-response callers without a readable raw body, deduplicate those callers through a raw-capable leader, and continue allowing complete leaders to serve data-only followers.
