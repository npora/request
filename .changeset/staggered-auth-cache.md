---
'@npora/request': patch
---

Reuse the application's current credential for delayed unauthorized responses after a completed shared refresh, while preserving token priority, cancellation and the one-replay limit. Skip cache persistence and stale fallback when a retry changes the request's credential identity.
