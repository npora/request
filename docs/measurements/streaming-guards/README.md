# Streaming guards: implementation and measurement evidence

This is an **unreleased candidate based on 1.19.6**, measured from clean commit
`10292db7f89605bb78512f121c7e60dd9ef05229`. The manifest still says 1.19.6; these are not measurements of the
already published package. The changeset requests a minor release.
Baseline consumer bundles were measured from clean commit
`085e55d05ca75ffae6833277ae6a44b5dcc65191`. Both builds use the same root dependency lock.

Runtime: v24.18.0, darwin
arm64, Apple M3.
Final reports share build SHA-256
`cb0f5c8cc237ceb05ed5815d114f14239a10fe8cd589daa1350fa4d34a11fec0`.

## Changes and verification

- Abort, attempt deadlines, and lifecycle deadlines discard decoded SSE/NDJSON records.
- Opt-in `streamIdleTimeout`, `maxStreamLineSize`, and `maxSseEventSize` bound reads and incremental UTF-8 record accounting. Event budgets also cover unfinished lines.
- Body failures interrupt pending item-schema validation; late results/rejections stay observed.
- Abort/size failures release readers and timers without waiting for source cleanup. Explicit native `reader.cancel()` still exposes the source cleanup promise.
- Internal helper names may shrink, while exported names remain checked in ESM and CommonJS.
- Configuration/security/migration documents explain destination trust and request-rate versus bandwidth limits.

All 930 unit/integration tests, 207 browser tests in three engines, installed
ESM/CommonJS contracts, source/public/example/benchmark types, package/API
contracts, documentation links, and complexity checks passed. Coverage:
92.61% statements, 88.86% branches, 94.18% functions, 92.88% lines.
See [recorded coverage totals](coverage.json) and the repository regression tests.

## Bundle and package costs

| Measurement | Baseline bytes | Candidate bytes | Change |
| --- | ---: | ---: | ---: |
| Basic core consumer, gzip | 13888 | 14287 | +399 |
| npm tarball | 136674 | 131899 | -4775 |
| npm unpacked | 516524 | 478824 | -37700 |

The npm artifact shrinks because internal names are minified. The application
bundle grows because it includes the new defensive behavior; its own bundler
already minifies helper names. We have not claimed a browser-bundle reduction.
Consumer ceilings increase by 400 gzip bytes per scenario; declaration ceilings
increase by 750 raw / 250 gzip bytes for the new documented public options.
Tarball, unpacked, and executable-subpath ceilings stay unchanged. Single-file,
initial-static, and all-split-chunk checks pass.

The baseline package was rebuilt from its Git archive in a temporary directory
with the same installed dependencies. Reproduce with
`node docs/measurements/streaming-guards/reproduce-baseline-size.mjs` from the
repository root. It writes an ignored baseline report and cleans its temporary
checkout. [Package before](package-before.json), [package after](package-after.json),
[consumer before](consumer-before.json), [consumer after](consumer-after.json).

### Fixed-version browser comparison

esbuild 0.28.2, minified browser ESM, ES2020,
gzip level 9. Feature sets differ; native Fetch counts only the application wrapper.
Versions: Axios 1.20.0, Ky 2.1.0,
ofetch 1.5.1.

| Entry | gzip bytes |
| --- | ---: |
| native-fetch | 102 |
| @npora/request | 14,279 |
| axios-default | 19,593 |
| axios-fetch | 19,599 |
| ky | 9,803 |
| ofetch | 4,080 |

[Baseline comparison](browser-before.json), [candidate comparison](browser-after.json).

## Serialized performance checks

- 10,000,000 mixed logical operations at concurrency 64: zero unexpected failures,
  50.58 seconds.
- 1,000,000 mixed logical operations at concurrency 256: zero unexpected failures,
  6.00 seconds.
- 1,000,000 NDJSON plus 1,000,000 SSE records: content checks, schema failure,
  cancellation propagation, slow-consumer yields, and existing memory budgets passed.
- All eight stable relative/streaming performance gates passed. Fragmented long-line
  measurements cover 64 KiB, 128 KiB, and 256 KiB payloads in 64-byte chunks.
- The ordinary six-client HTTP comparison received all 594,000 expected requests
  with zero invalid requests. Six rounds, 5,000 timed + 500 warmup requests per
  scenario/client/round, concurrency 64, 4,096 latency samples per run.
- Edge cases received 24,240 requests including warmup: delayed JSON, 64 KiB JSON,
  cancellation after headers, and verified streaming with consumer pauses. The
  6,060 intentional server disconnects include cancellation warmup.
- The separate 256-concurrency HTTP run received all 100,500 requests,
  including warmup. Its heap delta is not a retained-memory measurement.

| Scenario | Client | Median requests/s | Median p99 ms |
| --- | --- | ---: | ---: |
| get-json | native-fetch | 15,287 | 10.704 |
| get-json | @npora/request | 14,751 | 10.371 |
| get-json | axios-http | 8,837 | 11.849 |
| get-json | axios-fetch | 8,434 | 14.195 |
| get-json | ky | 12,307 | 13.396 |
| get-json | ofetch | 14,967 | 10.465 |
| post-json | native-fetch | 9,543 | 13.297 |
| post-json | @npora/request | 9,353 | 13.226 |
| post-json | axios-http | 7,793 | 12.666 |
| post-json | axios-fetch | 5,476 | 19.590 |
| post-json | ky | 7,153 | 18.108 |
| post-json | ofetch | 9,264 | 13.870 |
| query-json | native-fetch | 14,504 | 10.308 |
| query-json | @npora/request | 14,280 | 10.384 |
| query-json | axios-http | 8,261 | 12.856 |
| query-json | axios-fetch | 7,850 | 15.014 |
| query-json | ky | 10,883 | 15.739 |
| query-json | ofetch | 13,228 | 11.280 |

The throughput and latency columns are medians of runs, not pooled percentiles.
Axios HTTP uses a different transport/pool and can have lower POST p99 despite
lower throughput. The candidate is close to Fetch in these JSON fixtures, but
this does not establish an absolute ranking. Edge cases have one measured run
per client/scenario with rotated order and need more repetitions for ranking.
Their cancellation check requires eventual rejection, not identical buffered-data
semantics across libraries. Per-client server-disconnect deltas are asynchronous.

## Reproduce and inspect

See the [benchmark commands and methodology](../../benchmark.md), including the
new edge-case runner. Run performance suites sequentially. Source, runtime,
lock/build identities, validation counts, limitations, and artifact hashes are
recorded in [summary.json](summary.json).

Raw evidence: [HTTP rounds](http-comparison.json), [HTTP edge cases](http-edge-cases.json),
[HTTP concurrency](http-c256.json), [10M stress](stress-10m.json),
[256-concurrency stress](stress-c256.json), [streaming/schema](streaming-schema.json),
[request overhead](request.json), [fragmented lines](streaming-lines.json).

Mixed stress uses fixtures, rather than millions of real network calls. Results
are local Node measurements with no TLS or remote service and do not prove
production capacity, leak freedom, or behavior on every supported runtime.
Earlier-day snapshots are not paired baselines for a regression claim.
