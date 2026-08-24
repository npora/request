---
"@npora/request": patch
---

Make asynchronous refresh-policy, shared token-refresh and post-refresh token waits abortable per request without cancelling the shared refresh, and prevent removed auth plugins from retrying requests that were already waiting.
