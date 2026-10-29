---
"@npora/request": patch
---

Fix shared traffic plugin lifecycle isolation. Concurrency permits granted to another client are now released by their owning installation. Removing a concurrency, rate-limit, or circuit-breaker plugin from one client preserves other clients' queued requests, rolling budgets, Retry-After cooldowns, and circuit state. The final removal still clears shared state and timers.
