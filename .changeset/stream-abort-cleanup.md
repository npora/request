---
'@npora/request': patch
---

Release prefetched streaming readers and request timers immediately on abort even when source cancellation stays pending. Propagate cancellation to the total-timeout stream wrapper so queued data is discarded after the deadline. Preserve synchronous listener-registration aborts.
