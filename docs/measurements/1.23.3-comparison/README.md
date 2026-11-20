# Stable-client comparison, 2026-11-20

The measured source is the clean 1.23.3 release commit recorded in each report.
This is a dated snapshot, not a continuously updated leaderboard. Stable npm
`latest` metadata was checked on 2026-11-20: Npora 1.23.3, Axios 1.21.1,
Ky 2.2.0, ofetch 1.5.1, Got 16.2.0, Undici 8.13.0 and SuperAgent 10.4.2.
Only Npora, Axios, Ky, ofetch and native Fetch were benchmarked. Got, Undici
and SuperAgent were compared through their official documentation.

## Measurements

Apple M3, macOS arm64, Node.js 24.18.0. Each scenario uses six rotated-order
rounds, 250 warmups and 2,500 measured operations per client per round,
concurrency 32. JSON results are checked, not just fetched. Retries and
configurable timeouts are disabled. The query scenario uses GET URL parameters,
not the HTTP QUERY method. Axios HTTP disables environment proxy discovery;
Axios Fetch is measured separately.

| Client | GET JSON req/s | POST JSON req/s | GET query req/s | 64 KiB JSON req/s | Browser gzip bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Fetch | 15,335 | 9,562 | 14,595 | 4,215 | 102 |
| Npora 1.23.3 | 14,510 | 9,232 | 13,762 | 4,269 | 14,798 |
| Axios HTTP 1.21.1 | 8,347 | 7,679 | 8,206 | 3,370 | — |
| Axios Fetch 1.21.1 | 8,214 | 5,558 | 7,933 | 3,308 | 22,329 |
| Ky 2.2.0 | 11,604 | 6,940 | 10,122 | 3,930 | 11,711 |
| ofetch 1.5.1 | 14,624 | 9,042 | 13,526 | 3,859 | 4,080 |

Throughput values are round medians. Raw [small-response results](http.json)
and [64 KiB results](large.json) include p95/p99, individual rounds, order,
request counts and build/lock hashes. [Browser bundles](size.json) use esbuild
0.28.2, minified ESM, ES2020, gzip level 9 and the same basic JSON loading task.
Axios's default browser entry is 22,323 gzip bytes. Native Fetch's 102 bytes
exclude its built-in runtime implementation. Neither gzip size nor a six-round
loopback result establishes production latency, remote TLS or browser throughput.
The slightly higher Npora 64 KiB median than native Fetch is not evidence of a
universal speed advantage. Feature sets and default policies differ.

## Product implications

- Ky 2.2.0 already supports Standard Schema, QUERY and upload/download progress.
  These are not exclusive Npora features. Its streaming upload progress has
  runtime/protocol limitations documented upstream.
- Npora's useful combination is lazy SSE/NDJSON item validation and composed
  authentication, retry, cache, circuit-breaking and traffic-control lifecycles.
- Axios offers broader transport configuration and migration familiarity.
- Got's Node-specific advanced timeouts, timings, pagination and streams are
  useful references, rather than requirements for a browser/Edge core.
- Undici supplies Node pooling, proxy and TLS controls through Fetch injection.
- SuperAgent offers mature chainable forms and transfer workflows.
- React Native and Mini Program compatibility remain unverified. Export
  conditions alone do not supply missing platform APIs.

Official references: [Axios configuration](https://axios-http.com/docs/req_config),
[Ky](https://github.com/sindresorhus/ky),
[Got](https://github.com/sindresorhus/got),
[ofetch v1](https://github.com/unjs/ofetch/tree/v1),
[Undici](https://github.com/nodejs/undici),
[SuperAgent](https://github.com/forwardemail/superagent).

## Size investigation and follow-up fix

A candidate sharing FormData/URLSearchParams brand-check implementations saved
103 raw bytes but increased the basic comparison bundle from 14,798 to 14,824
gzip bytes. It was rejected. The earlier parser-only lazy-loading experiment
also remains rejected; see [its measured decision](../streaming-split/README.md).
No size ceilings were raised and no hidden asynchronous chunks were introduced.

New real HTTPS tests then reproduced a correctness defect: gzip overhead could
make an 11-byte decoded JSON response exceed a limit of 11 when its encoded
Content-Length was larger. The soft HTTP error parsing limit could also discard
a small valid error body. The follow-up patch shares decoded Content-Length
interpretation across response limits and download progress. Coded responses
are bounded by bytes actually read; plain and identity responses retain early
header rejection. The table above deliberately remains the clean 1.23.3 baseline,
not a performance measurement of that follow-up patch.

## Reproduce

Install the pinned fixtures with scripts disabled, build first, then run the
workloads sequentially. A loopback listener is required. Output stays in ignored
local artifacts, not in the published npm package.

```sh
npm ci --prefix benchmark/competitors --ignore-scripts
pnpm build
pnpm benchmark:compare -- --operations 2500 --concurrency 32 --warmup 250 --rounds 6 --output .artifacts/comparison/http.json
pnpm benchmark:compare -- --large-json --operations 2500 --concurrency 32 --warmup 250 --rounds 6 --output .artifacts/comparison/large.json
pnpm benchmark:compare:size -- --output .artifacts/comparison/size.json
```

## Follow-up validation

Local verification of the patch passed 1,129 unit/integration tests, 291 browser
cases, 44 website desktop/mobile cases, 22 HTTPS/Undici cases and 26 Axios
migration cases. workerd, current/next TypeScript, public consumers, package
installation, complexity and unchanged size/performance budgets passed. A
controlled stress test completed 1,000,000 logical operations without unexpected
failures; schema streams validated 2,000,000 items. These are local verification
results, not claims of production capacity or public-network reliability.

The complete CJS runtime dependency closure decreased from 53,671 to 53,638
gzip bytes. The core+retry consumer is 16,222 bytes against the unchanged 16,225
ceiling. No broad percentage size reduction is claimed: the decoded-length
correctness guard has a small basic-consumer cost. Benchmark tables above stay
attached to the original clean baseline and its recorded hashes.
