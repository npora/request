---
'@npora/request': patch
---

Prevent body-bearing requests from using automatic cache keys that omit the
body, preserve explicitly null error data, reject malformed structured request
options, prevent inherited plugin defaults from entering request overrides,
reuse trailing URL query delimiters, reduce native Request reuse allocations,
snapshot sanitized client defaults to avoid repeated ownership probes, accept
pnpm's leading benchmark argument delimiter, skip body ownership probes for
known body-free client defaults, bound latency sampling in the core and real
HTTP benchmark runners, avoid exception-driven native Request detection for
plain request configs, remove the direct request API's redundant async wrapper,
add an origin-isolated rolling-window request rate limiter, validate and
transform individual SSE and NDJSON items lazily with Standard Schema, and
add dependency-free OpenTelemetry client spans and trace-context propagation,
and strengthen type and release verification.
