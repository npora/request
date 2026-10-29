---
"@npora/request": patch
---

Reduce browser bundle size by moving internal configuration-merging helpers from private static methods to module-local functions and sharing the existing object guard. Public client APIs and configuration semantics are unchanged. Tighten consumer bundle budgets to preserve the measured savings.
