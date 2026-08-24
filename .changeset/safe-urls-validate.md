---
'@npora/request': patch
---

Reject non-string `baseURL` values and malformed HTTP(S) `url` or `baseURL`
forms before adapter dispatch, preventing runtime-dependent URL normalization
from changing the intended request target. Ignore inherited values while
merging configuration and reject reserved request fields supplied through a
prototype chain before adapters or plugins can consume them.

Prevent timeout allocation when a custom external signal aborts synchronously
during listener registration, and cancel streaming response readers if abort
listener setup fails so request cleanup cannot be deferred indefinitely.

Avoid retaining retry timers or concurrency queue entries when custom abort
signals fire synchronously during listener registration, and keep permit
handoff progressing when listener removal throws.

Replace the concurrency wait array with a constant-time FIFO queue so permit
handoff, cancellation, timeout, and plugin removal do not degrade as queue
depth grows.

Make cache-deduplication followers settle idempotently when abort registration
fires synchronously or listener cleanup fails, without retaining a subscription
to the shared request after cancellation.

Prevent XMLHttpRequest transports from sending after synchronous abort
registration, and keep XHR settlement progressing when abort-listener cleanup
throws.

Make delayed MockAdapter responses roll back listener and timer setup safely,
including synchronous abort registration and listener-cleanup failures.

Roll back timeout-signal listener registration when listener or timer setup
throws, and clear handles returned by synchronously firing custom timers.

Apply the same transactional setup to retry delays so listener and timer
initialization failures cannot retain cancellation resources.

Avoid redundant circuit-breaker Map delete/set operations when consecutive
requests use the same isolation key while preserving LRU refresh on key
changes.
