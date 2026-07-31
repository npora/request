---
"@npora/request": minor
---

Remove the undocumented global `clearCache()` export. Cache stores are isolated
per plugin instance and should be invalidated through the `clear()` method on
the value returned by `cachePlugin()`.

Add an exact package export contract so accidental runtime or type exports are
caught before the public API is frozen for 1.0.
