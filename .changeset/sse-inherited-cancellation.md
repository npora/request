---
'@npora/request': patch
---

Honor inherited client cancellation signals while waiting to reconnect SSE streams, including extended clients. Preserve request-level signal overrides and explicit signal removal.
