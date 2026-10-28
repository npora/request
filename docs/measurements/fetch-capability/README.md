# Fetch capability reliability patch

Measured on 2026-10-28 on Node.js 24.18.0, Apple M3/macOS arm64. This snapshot
records the working-tree patch based on released 1.21.0 before patch publication.
Build reports retain that manifest version and mark the worktree dirty. Use
the distribution hashes and source changes to identify the measured candidate;
checking out only its recorded base commit reproduces the baseline.

## Changes

- Resolve and validate Fetch before allocating transport resources. Missing or
  non-callable implementations produce CONFIG_ERROR and do not trigger network
  retries. Injected Fetch, custom adapters and already-aborted signals retain
  their contracts.
- Share installed-package capability checks between offline tarballs and npm
  registry verification, in ESM and CommonJS. Verify SSE reconnect/early-close
  states, form errors and prototype keys, invalid lock/channel configuration,
  and cache operation without coordination.
- Extract internal method configuration types and remove a forwarding-only
  constructor helper. Client.ts decreases from 795 to 764 lines. No public
  exports or method signatures change.
- Centralize generated reports in ignored `.artifacts/`, add allowlisted
  `pnpm clean` / `pnpm clean:dry-run`, and preserve dependencies, local settings,
  source and archived measurements. Cleanup tests cover preview, repeated runs,
  source/secret preservation and symlink boundaries.
- Update the comparison fixture to Axios 1.21.0; pin the isolated Edge fixture
  to Undici 7.30.1 to address the newly reported advisories. Production runtime
  dependencies remain zero.

## Verification

Local validation passed: 985 Node tests; 219 Chromium/Firefox/WebKit tests;
26 Axios HTTP/Fetch migration contracts including literal Link defaults with
null-prototype headers; public exports, types, package contents, offline
installation, registry-installed capability checks, workerd and injected Undici.
Current/next TypeScript, examples, benchmark types and source complexity gates
passed. Coverage: 92.94% statements, 89.06% branches, 94.78% functions and
93.17% lines. Root, comparison and updated Edge fixture audits found zero known
vulnerabilities. Local runtime tests used Node 24; CI supplies Node 22/24/26.

All existing consumer, package, complexity and relative performance ceilings
remain unchanged. The [internal request report](request.json) and
[two-million-item stream report](streaming.json) pass the existing throughput,
ordering, cancellation and retained-memory requirements. Controlled adapters
and streams do not represent network throughput or production capacity.

## Consumer size

[Released baseline](baseline-consumer.json), [patch](consumer.json),
[distribution/tarball](package-size.json).

| Application | 1.21.0 gzip bytes | Patch gzip bytes |
| --- | ---: | ---: |
| Root basic | 14,509 | 14,522 |
| Core basic | 14,510 | 14,524 |
| Core + retry | 15,866 | 15,880 |
| Core + full cache | 21,006 | 21,022 |
| Core + memory cache | 15,707 | 15,730 |
| Root + retry + cache | 22,349 | 22,368 |
| Core + retry + cache | 22,406 | 22,421 |
| Schema errors only | 268 | 268 |

Every scenario emits one file with no lazy chunks. The configuration fix has
a small net size cost; this is not a claim of reduced consumer bundle size.
Moving type definitions improves maintenance without adding runtime code.

## Axios 1.21.0 comparison

[Small JSON](comparison.json), [64 KiB JSON](large-comparison.json),
[browser bundle entries](competitor-size.json).

Pinned versions: Axios 1.21.0, Ky 2.2.0, ofetch 1.5.1. Six rounds rotate client
order; each round uses 2,500 measured operations, 250 warmups and concurrency
32. Ordinary requests disable retries and configurable timeouts. The server
verifies every received request and response value: 297,000 requests in the
small-response run and 99,000 in the large-response run, with zero invalid
requests. Large responses contain a 65,536-character string plus JSON envelope.

| Client | GET JSON median req/s | POST JSON median req/s | Query JSON median req/s | 64 KiB GET median req/s | Browser gzip bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Fetch | 15,180 | 9,446 | 14,229 | 4,150 | 102 |
| Patch | 14,502 | 9,136 | 13,993 | 4,200 | 14,518 |
| Axios HTTP | 8,614 | 7,858 | 8,141 | 3,343 | — |
| Axios Fetch | 8,219 | 5,519 | 7,803 | 3,390 | 22,292 |
| Ky | 11,859 | 7,016 | 10,485 | 3,761 | 11,711 |
| ofetch | 13,986 | 9,084 | 12,559 | 3,809 | 4,080 |

Axios's default browser entry is 22,287 gzip bytes. Bundles use esbuild 0.28.2,
ESM/ES2020 and gzip level 9. Different entry text explains 14,518 comparison
bytes versus 14,524 standard consumer bytes. Native Fetch's tiny wrapper
excludes the browser/runtime implementation. Capabilities are not identical.

These loopback results support competitive throughput for these fixtures,
while Ky/ofetch still have smaller bundles. Small differences versus native
Fetch can be noise. Compare same-run medians, min/max and p95/p99; do not infer
speedup/regression from the older October 22 report, different host load or
different Axios versions. No TLS/remote-service, browser throughput or universal
performance claim follows from these measurements.

## Reproduce and clean

```sh
pnpm build
npm ci --prefix benchmark/competitors --ignore-scripts
pnpm test:migration:axios
pnpm benchmark:consumer-size -- --output .artifacts/package-size/recheck.json
pnpm benchmark:consumer-size:check .artifacts/package-size/recheck.json
pnpm benchmark:compare -- --operations 2500 --concurrency 32 --warmup 250 --rounds 6 --output .artifacts/benchmarks/recheck.json
pnpm benchmark:compare -- --large-json --operations 2500 --concurrency 32 --warmup 250 --rounds 6 --output .artifacts/benchmarks/recheck-large.json
pnpm clean:dry-run
pnpm clean
```

Run benchmark workloads sequentially. Archive intended evidence before cleanup;
the cleaner retains `docs/measurements/`. Historical reports keep their original
versions, paths and provenance rather than being relabeled as new results.
