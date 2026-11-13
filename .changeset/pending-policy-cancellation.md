---
'@npora/request': patch
---

Observe already-started asynchronous retry and circuit-breaker policy promises when cancellation wins during abort-listener setup, preventing late policy failures from becoming unhandled rejections.
