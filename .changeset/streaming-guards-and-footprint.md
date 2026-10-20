---
"@npora/request": minor
---

Stop SSE/NDJSON iteration from returning buffered records after cancellation or
request deadlines. Add opt-in streamIdleTimeout, maxStreamLineSize, and
maxSseEventSize guards with incremental UTF-8 accounting and prompt cleanup.
Shrink distributed JavaScript by minifying internal helper bindings while
preserving exported names. Clarify URL trust and Axios bandwidth-limit migration,
and extend the pinned HTTP comparison to adverse streaming/network scenarios.
