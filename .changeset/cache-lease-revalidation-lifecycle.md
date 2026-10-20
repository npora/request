---
'@npora/request': patch
---

Release cache refresh leases granted after cancellation or plugin removal, make post-acquisition cache reads cancellable, and preserve conditional revalidation and cache identity when request deduplication is disabled. Remove redundant cache generation tracking and response key serialization.
