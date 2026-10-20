# Shared response reader measurement

The Fetch transport now enforces a streaming response's size limit in the same
reader wrapper that owns cancellation and attempt-timeout cleanup. The parser
uses the already-bounded body rather than wrapping it again. Previously, bounded
data streams used two wrappers; complete responses used three. The normal
bounded Fetch stream now uses one. Total-timeout and plugin wrappers are separate.
Public request methods, types, error codes, and buffered parsing remain intact.

## Local reader cost

Node.js 24.18.0, Apple M3, macOS arm64. Each run consumed 200,000 chunks of
256 bytes (51,200,000 bytes), after a 10,000-chunk warmup, with a size limit
matching the payload and a 30-second timeout. Five rounds per interface:

| Interface | Before median | After median | Duration reduction |
| --- | ---: | ---: | ---: |
| Data stream | 160.13 ms | 101.30 ms | 36.7% |
| Complete response stream | 218.04 ms | 101.71 ms | 53.4% |

This is an in-memory small-chunk diagnostic. The source reuses an immutable byte
array to isolate wrapping overhead. The two builds run sequentially rather than
as paired interleaved rounds. These numbers are not predictions for network,
browser, SSE parsing, file downloads, allocation-heavy sources, or large chunks.
The reports retain all raw samples and identify the exact build hashes. Both
record dirty working trees while the implementation and runner were being edited;
the baseline build hash matches the earlier clean 1.19.3 artifacts.

Reproduce with [the reader benchmark](../../benchmark.md#bounded-response-reader-benchmark),
building each revision before running. For the old behavior, use the runtime
source from commit `5540154` with the same benchmark runner. The after source is
the shared-reader change accompanying this report. The runner imports built
artifacts rather than source.

## Bundle cost and verification

Basic core consumer size changes from 46,246 to 46,093 raw bytes and from 13,889
to 13,878 gzip bytes. The gzip saving is only 11 bytes; this change's main benefit
is stream-reader cost. There are no new dynamic imports. Existing consumer,
package, declaration, tarball, and performance budgets remain fixed and pass.
README navigation was consolidated into the existing entry table to remove
repeated links and keep the complete published package within its budget.

Validation completed for this change:

- 852 unit/integration tests and existing coverage thresholds.
- Six new cases for bounded streams, including cancellation rejection, abort
  while source cancellation is pending, oversized headers, and idle timeout.
- 195 Chromium, Firefox, and WebKit tests.
- Two million validated NDJSON/SSE items, backpressure and cleanup checks.
- Existing relative request and streaming performance gates.
- Type checks for source, public consumers, examples, and benchmarks; public ESM
  and CommonJS exports and response contracts; complexity and package budgets.

Raw evidence:

- [Before: all reader rounds and build metadata](baseline.json)
- [After: all reader rounds and build metadata](after.json)
- [Consumer bundles, including initial and total split output](consumer.json)
