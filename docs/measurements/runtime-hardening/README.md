# Runtime hardening candidate and comparison

Measured on 2026-10-22 with Node.js 24.18.0, macOS arm64. This is an
**unreleased working-tree candidate based on 1.20.2**, with a minor Changeset.
The manifest still says 1.20.2; reports mark the worktree dirty and identify
the base commit and distribution hash. Results are not measurements of the
unchanged npm release or proof of speedup over a controlled before run.

## Changes and verification

Changes: validate tiered-cache lock/channel capabilities; add isolated SSE
lifecycle notifications; provide optional schema issue mapping; consolidate
duplicate response-size guards; verify real Worker environments and Undici;
extend Axios migration contracts and pin the current stable Ky comparison.

| Verification | Result |
| --- | --- |
| Node unit/integration | 972 tests passed |
| Coverage | Statements 92.91%, branches 89.02%, functions 94.78%, lines 93.15% |
| Chromium / Firefox / WebKit | 219 tests passed, including Service Workers and SSE state/abort |
| workerd via Miniflare | JSON/schema, multipart, timeout, abort, SSE, NDJSON, tiered cache and form mapping passed; Web Locks absent |
| Injected Undici over real HTTP | Pool reuse, timeout, abort and early stream closure passed |
| Axios HTTP and Fetch migration | 24 cases passed |
| Package contracts | Dual-format exports, declarations, tarball, offline installed consumers and onboarding/streaming workflows passed |
| Documentation and bundle contracts | 13 documentation and 4 bundle tests passed |
| TypeScript | Current, next, public consumers, examples and benchmarks passed |
| Complexity | 93 production files passed |
| Dependency audits | Root, Edge fixture and competitor fixture: zero known vulnerabilities |
| Relative performance gates | Passed without lowering throughput or memory requirements |
| Mixed stress | 1,000,000 logical operations, concurrency 64, zero unexpected failures |

Node tests ran locally on Node 24; existing CI targets 22/24/26. Local results
do not claim those remote jobs have run. See [runtime support](../../runtimes.md)
for tested capabilities and limits. No production Edge deployment was performed.

## Consumer bundle cost

[Baseline](baseline-consumer.json), [candidate](consumer.json),
[package closure and tarball report](package-size.json).

| Application | Baseline gzip bytes | Candidate gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Root basic | 14,286 | 14,509 | +223 |
| Core basic | 14,287 | 14,510 | +223 |
| Core + retry | 15,646 | 15,866 | +220 |
| Core + full cache | 20,792 | 21,006 | +214 |
| Core + memory cache | 15,507 | 15,707 | +200 |
| Root + retry + cache | 22,137 | 22,349 | +212 |
| Core + retry + cache | 22,203 | 22,406 | +203 |
| Standalone schema-error helper | — | 268 | Optional entry |

Each output is one file, with no hidden lazy chunks. These are explicit feature
costs, not size reductions. Consumer ceilings increase by 200 bytes per existing
scenario, using existing headroom; the helper gets its own 400-byte ceiling.
Declaration ceilings increase by 600 raw/350 gzip bytes. Executable-subpath,
tarball and unpacked ceilings remain unchanged. The helper is absent from
basic client bundles.

## Stable-version HTTP comparison

[Small-response six-round results](comparison.json),
[64 KiB JSON six-round results](large-comparison.json), [browser bundles](competitor-size.json).
Pinned versions: Axios 1.20.0, Ky 2.2.0, ofetch 1.5.1. Each client runs 2,500
measured operations and 250 warmups per round, concurrency 32; order rotates
over six rounds. The server verified all 297,000 requests with zero invalid
requests. Retries and configurable timeouts are disabled.

| Client | GET JSON median req/s | POST JSON median req/s | Query JSON median req/s | 64 KiB GET median req/s | Browser gzip bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Fetch | 22,689 | 14,523 | 21,622 | 7,058 | 102 |
| Candidate | 22,435 | 14,174 | 21,474 | 6,843 | 14,502 |
| Axios HTTP | 13,983 | 12,426 | 13,338 | 5,571 | — |
| Axios Fetch | 13,322 | 8,825 | 12,791 | 5,668 | 19,599 |
| Ky | 17,755 | 10,900 | 16,009 | 6,421 | 11,711 |
| ofetch | 21,812 | 14,107 | 20,794 | 6,183 | 4,080 |

The additional 64 KiB GET comparison uses the same six-round/rotated-order
configuration and verifies 99,000 requests. Its response JSON includes a
65,536-character payload plus the JSON envelope; the server adds no timer.

Axios's default browser entry is 19,593 gzip bytes. Bundle configuration is
esbuild 0.28.2, ESM, ES2020 and gzip level 9. The comparison entry differs from
the standard consumer fixture, explaining 14,502 versus 14,510 candidate bytes.
Native Fetch's 102 bytes exclude its built-in runtime implementation.

The candidate is close to native Fetch throughput in these small-response
loopback scenarios and ahead of the tested Axios/Ky paths. Its bundle remains
larger than Ky and ofetch. Libraries offer different capabilities. This does
not establish a universal lead, production/browser throughput, remote TLS
latency, or a causal speedup from this patch. Raw reports include min/max,
p95/p99 and individual rounds.

## Adverse bodies and streaming

[HTTP diagnostics](edge-cases.json), [stream schemas](streaming.json),
[fragmented lines](lines.json), [internal request paths](request.json),
[mixed stress](stress.json).

HTTP diagnostics run 64 operations, concurrency 8 and 8 warmups per client and
scenario: delayed JSON, 64 KiB JSON, cancellation after headers, slow-consumer
streams and 16 MiB binary streams. Each client's measured binary output is
exactly 1 GiB, verified with SHA-256; all 64 cancellations propagate per client.
Axios HTTP uses a Node-to-Web bridge. These are single runs with rotated order,
not robust performance rankings. The candidate's 64 KiB JSON result is lower
in this single diagnostic run. The separate six-round comparison above, using
the common server without a response timer, does not reproduce that ordering.
Different fixtures and warmup/order can affect results; this does not justify
changing parsing semantics or claiming absence of a performance regression
against an unmeasured before build.

The schema benchmark validates 1,000,000 NDJSON records and 1,000,000 SSE events,
ordered values and cross-chunk parsing, 100 slow-consumer yields per format,
and schema/consumer cancellation. Rates are approximately 1.30 million NDJSON
records/s and 0.75 million SSE events/s; retained post-GC heap is approximately
0.20 MiB and 0.08 MiB. Controlled fixtures do not measure network throughput.
Mixed stress uses controlled transports, not one million HTTP requests, and
cannot establish production capacity or absence of leaks.

## Ten-library feature review

This is a defined-scope high-star comparison group, not an official GitHub
ranking: standalone general JS/TS HTTP clients, excluding GUI tools,
framework-specific request layers and pure Fetch polyfills. Stars are the
2026-10-22 query snapshot. Only the subset above was benchmarked.

| Library | Stars | Useful reference |
| --- | ---: | --- |
| [Axios](https://github.com/axios/axios) | 109,303 | Adapters and migration/HTTP compatibility |
| [request](https://github.com/request/request) | 25,487 | Historical transport coverage; deprecated |
| [Ky 2.2.0](https://github.com/sindresorhus/ky/tree/v2.2.0) | 17,130 | Fetch lifecycle, Standard Schema and errors |
| [SuperAgent](https://github.com/forwardemail/superagent) | 16,629 | Forms, uploads and progress |
| [Got](https://github.com/sindresorhus/got) | 14,953 | Node diagnostics, streams and timeouts |
| [node-fetch](https://github.com/node-fetch/node-fetch) | 8,847 | Explicit Fetch/runtime differences |
| [Undici](https://github.com/nodejs/undici) | 7,719 | Injected transport and pool management |
| [ofetch v1](https://github.com/unjs/ofetch/tree/v1) | 5,364 | Concise data/error API; exclude v2 alpha |
| [Wretch](https://github.com/elbywan/wretch) | 5,180 | Optional modules |
| [Redaxios](https://github.com/developit/redaxios) | 4,868 | Lightweight Axios-style subset |

The review supports capability validation, explicit runtime boundaries and
optional helpers. It does not justify registration-order onion warnings for
the stage-based Pipeline, silent loss of explicit coordination, or claims that
conditional exports provide Mini Program compatibility. Mock recording and
platform adapters remain separate future features, not shipped capabilities.

## Reproduce

Build this candidate source tree first; checking out only the dirty report's
base commit reproduces the baseline without the candidate changes.

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm ci --prefix benchmark/competitors --ignore-scripts
npm ci --prefix test/edge --ignore-scripts
pnpm build
pnpm test:coverage
pnpm test:browser
pnpm test:edge
pnpm test:migration:axios
pnpm test:package
pnpm benchmark:consumer-size -- --output package-size-results/recheck.json
pnpm benchmark:consumer-size:check package-size-results/recheck.json
pnpm benchmark:compare -- --operations 2500 --concurrency 32 --warmup 250 --rounds 6 --output benchmark-results/recheck.json
pnpm benchmark:compare -- --large-json --operations 2500 --concurrency 32 --warmup 250 --rounds 6 --output benchmark-results/recheck-large.json
pnpm benchmark:compare:size -- --output package-size-results/recheck-comparison.json
node --import tsx benchmark/competitors/edge-cases.mjs --operations 64 --concurrency 8 --warmup 8 --output benchmark-results/recheck-edge.json
```

Run performance workloads sequentially. Environment noise, payloads, transport
pools and platform implementations affect results.
