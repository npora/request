---
'@npora/request': minor
---

Add first-class streaming parsers for server-sent events and newline-delimited
JSON. The new `sse` and `ndjson` response types expose lazy async iterables,
support content-type detection, cancel readers when iteration ends early, and
preserve timeout, cancellation, and response-size enforcement while streaming.
Streaming responses bypass cache persistence and unsafe iterator sharing.
