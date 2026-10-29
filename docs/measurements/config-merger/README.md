# Configuration merger bundle reduction

Measured on 2026-10-29 with Node.js 24.18.0, macOS arm64, esbuild 0.28.2,
ES2020 browser ESM and gzip level 9. The baseline is clean released 1.21.3 at
`1a86ff8d3b5968f9ef74d5f04911166fca10d9d5`. The candidate was measured before
commit with only `src/core/ConfigMerger.ts` modified. Its metadata therefore
retains version 1.21.3, the baseline commit and a dirty worktree; that commit
alone reproduces the baseline, not the candidate. Build and lockfile hashes
identify both measured distributions.

Internal private static helpers become module-local functions, allowing their
names and call sites to be shortened. The existing record-object guard also
replaces an identical context guard. Client APIs, configuration precedence,
header normalization and prototype checks remain unchanged. No dynamic imports,
dependencies or runtime branches are added.

| Consumer | Baseline gzip bytes | Candidate gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Root basic | 14,522 | 14,465 | -57 |
| Core basic | 14,524 | 14,458 | -66 |
| Core + retry | 15,880 | 15,824 | -56 |
| Core + full cache | 21,022 | 20,968 | -54 |
| Core + memory cache | 15,730 | 15,675 | -55 |
| Root + retry + cache | 22,368 | 22,310 | -58 |
| Core + retry + cache | 22,421 | 22,343 | -78 |
| Schema errors only | 268 | 268 | 0 |

This is a modest reduction: core basic saves about 0.45%, not a new lightweight
client. Every scenario still emits one file, with no lazy chunks. Consumer
ceilings are tightened below the old measurements, retaining 25–42 gzip bytes
of headroom for affected scenarios. Distribution and runtime budgets are not
relaxed. [Baseline](baseline.json), [candidate](consumer.json).

Verification passed: 993 tests in 59 files, current/next TypeScript and source
complexity. The [request report](request.json) and
[two-million-item streaming report](streaming.json) pass existing relative
throughput, ordering, cancellation and memory gates. These were run sequentially
after the test suite. They check regression budgets; there is no before/after
throughput comparison or claim of improved request speed. No new competitor
timing run is implied by this internal refactor.

Reproduce from the corresponding implementation, with dependencies installed:

```sh
pnpm build
pnpm benchmark:consumer-size -- --output .artifacts/package-size/config-merger.json
pnpm benchmark:consumer-size:check .artifacts/package-size/config-merger.json
pnpm benchmark -- --output .artifacts/benchmarks/config-merger-request.json
pnpm benchmark:streaming -- --output .artifacts/benchmarks/config-merger-streaming.json
pnpm benchmark:check -- --budget benchmark/performance-budget.json --request .artifacts/benchmarks/config-merger-request.json --streaming .artifacts/benchmarks/config-merger-streaming.json
```
