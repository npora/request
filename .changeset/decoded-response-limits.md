---
'@npora/request': patch
---

Apply Fetch response size limits to decoded bytes instead of encoded Content-Length for compressed responses. Preserve small compressed HTTP error bodies within the error parsing limit, while continuing to reject decoded expansion beyond the configured cap. Share length interpretation with download progress and verify injected Undici 8.13.0 over local HTTPS.
