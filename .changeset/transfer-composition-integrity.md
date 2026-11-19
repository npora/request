---
'@npora/request': patch
---

Share a single XHR for simultaneous upload and download progress, and reject upload-progress requests that explicitly require Fetch or streaming downloads before network I/O. Preserve download bytes when custom stream producers reuse their buffers. Omit unknown decoded totals for Fetch responses with Content-Encoding instead of mixing compressed Content-Length with decoded progress.
