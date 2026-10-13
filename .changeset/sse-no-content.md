---
'@npora/request': patch
---

Return an empty SSE iterable for bodyless responses and stop optional
reconnection when the server responds with HTTP 204 No Content.
