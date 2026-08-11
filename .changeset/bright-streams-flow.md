---
'@npora/request': minor
---

Add backpressure-aware download stream output through
`extensions.download.output: 'stream'`. Stream downloads report progress as
the consumer reads, propagate cancellation to the response body, preserve
response-size enforcement, and reject unsupported XHR combinations before
network I/O.
