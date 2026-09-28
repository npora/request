---
"@npora/request": patch
---

Split full-cache state, mutations, operation ordering, statistics, request
lookup, miss coordination, response handling, and installation cleanup into
internal modules while preserving public exports and cache behavior. Remove
cache source complexity exceptions, share asynchronous read handling, and
account for the measured module-boundary bundle cost.
