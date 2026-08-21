---
"@npora/request": patch
---

Reduce request configuration merge work by inheriting default body modes directly and clearing them only when the request supplies an explicit body mode.
