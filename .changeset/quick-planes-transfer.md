---
'@npora/request': minor
---

Add per-event byte deltas, average transfer rate, and estimated remaining time
to upload and download progress callbacks while preserving the existing
loaded, total, and progress fields. Fetch-stream downloads now also report an
empty transfer exactly once.
