---
"@npora/request": patch
---

Separate IndexedDB cache types, transaction helpers, record accounting, option
validation, and schema pruning into internal modules while preserving public
exports, transaction ordering, and storage behavior. Remove the remaining
source complexity exemption.
