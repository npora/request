---
'@npora/request': minor
---

Add stale-while-revalidate caching with response directive and request-level
window support. Eligible stale entries return immediately while one abortable,
deduplicated refresh runs through the owning client pipeline in the background.
