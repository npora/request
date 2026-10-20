# Version 1.19.3 measurement snapshot

Measured at `2026-10-20T03:07:18.574Z` from clean commit `3e84b55bf6c3ffa1f7cdc5323e622c3b85ec28ed`.
Runtime: v24.18.0, darwin arm64, Apple M3 (8 logical CPUs).

These are local measurements of fixed versions, not universal performance rankings.
See [methodology and commands](../../benchmark.md#pinned-library-comparison) before comparing results.

## Browser bundle cost

esbuild 0.28.2, minified ESM, browser platform, ES2020, gzip level 9. Each entry
exports a parsed-JSON request function. Feature sets differ. Native Fetch counts
only the wrapper; its browser implementation is not included.

| Entry | JavaScript bytes | Gzip bytes | Gzip KiB |
| --- | ---: | ---: | ---: |
| native-fetch | 88 | 102 | 0.10 |
| @npora/request | 46,236 | 13,881 | 13.56 |
| axios-default | 51,159 | 19,593 | 19.13 |
| axios-fetch | 51,175 | 19,599 | 19.14 |
| ky | 28,640 | 9,803 | 9.57 |
| ofetch | 10,137 | 4,080 | 3.98 |

The regular consumer report measures core basic at 13,889 gzip bytes, core plus
retry at 15,251, memory cache at 15,104, and full cache at 20,364. All existing
consumer budgets pass without increases. The separate comparison entry has a
slightly different wrapper and measures core basic at 13,881 bytes. Root and
core imports yield practically the same basic application size after tree shaking.

## Local HTTP results

Six rounds per scenario, 5,000 timed requests and 500 warmup requests per
client/round, concurrency 64, and 4,096 sampled latencies per timed run.
All 594,000 server requests were received with zero invalid requests.
Values below are medians of the six runs, not pooled latency percentiles.
Versions: Axios 1.20.0, Ky 2.1.0, ofetch 1.5.1, Npora Request 1.19.3.

### get-json

| Client | Requests/s | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| native-fetch | 23,248 | 6.103 | 6.905 |
| @npora/request | 22,458 | 6.375 | 7.030 |
| axios-http | 13,914 | 6.638 | 7.553 |
| axios-fetch | 13,252 | 7.201 | 9.502 |
| ky | 18,491 | 6.649 | 8.925 |
| ofetch | 22,657 | 6.346 | 7.487 |

### post-json

| Client | Requests/s | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| native-fetch | 14,620 | 8.118 | 8.891 |
| @npora/request | 14,332 | 8.055 | 8.899 |
| axios-http | 12,333 | 7.083 | 8.106 |
| axios-fetch | 8,857 | 9.791 | 12.820 |
| ky | 11,355 | 8.825 | 10.534 |
| ofetch | 13,941 | 8.219 | 9.199 |

### query-json

| Client | Requests/s | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| native-fetch | 22,113 | 6.099 | 7.101 |
| @npora/request | 21,672 | 6.296 | 6.972 |
| axios-http | 13,304 | 6.730 | 7.477 |
| axios-fetch | 12,730 | 7.225 | 8.821 |
| ky | 16,721 | 6.976 | 8.809 |
| ofetch | 20,192 | 6.569 | 7.372 |

Npora throughput is close to native Fetch in these workloads. Its POST p99
is higher than Axios HTTP despite higher throughput. GET throughput is close
to ofetch. These results support investigating bundle cost before optimizing
simple JSON throughput; they do not establish performance for remote services,
TLS, browser networking, large responses, or streaming.

## Next optimization to investigate

The basic core bundle retains 27,406 uncompressed output bytes from the generated
createClient chunk and 15,849 from the generated errorResponseTimeout chunk.
Together they account for about 94% of the 46,246-byte bundle. These are shared
build chunks containing multiple source modules, not costs attributable only to
their names. Inspect their client/reconnection and parsing/streaming dependencies
before proposing a split. Measure gzip and request behavior again after any change;
the contribution ranking alone does not prove removable bytes.

## Raw evidence

- [Consumer bundles and ranked contributions](consumer.json)
- [Browser comparison and exact entry strings](browser-comparison.json)
- [HTTP comparison, all rounds, order, and request counts](http-comparison.json)

Reports record Git/build/lockfile hashes and runtime details. Heap deltas in
HTTP rounds are uncollected process heap differences and must not be interpreted
as retained or peak memory. The fixture shares a process and native Fetch pools;
Axios HTTP uses its own transport and connection management. Results are
diagnostic, not an external-library CI gate.
