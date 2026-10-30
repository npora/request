---
"@npora/request": patch
---

Stop retry policy continuations after cancellation or total timeout, so late
asynchronous policy, delay, or jitter results cannot emit phantom retry events
or invoke subsequent retry callbacks after the request has settled.
