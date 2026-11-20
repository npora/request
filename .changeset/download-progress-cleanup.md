---
'@npora/request': patch
---

Reject buffered and streaming download progress failures promptly even when the source's cancellation promise never settles. Release reader ownership without waiting for cleanup and observe late cancellation rejections while preserving the original callback error. Update the published homepage to https://www.npora.live/.
