# 1.20.0 streaming split experiment

Decision: retain static imports. This candidate moves both SSE/NDJSON parsing
and SSE reconnection behind dynamic imports, preserving existing public method
signatures. It is an experiment, not a shipped implementation.

The baseline is the current 1.20.0 worktree based on commit 682f2da, including
the pending cache credential/transport and server retry-timing fixes. Both
reports record a dirty worktree. Runtime, bundler version, dependency lock hash,
and distribution hashes are recorded in the JSON reports. No dependencies or
size budgets were changed between measurements.

## Core basic consumer

| Measurement | Baseline gzip bytes | Candidate gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Single bundle | 14,287 | 14,661 | +374 |
| Split initial static closure | 14,287 | 13,383 | -904 |
| All split chunks | 14,287 | 15,943 | +1,656 |
| Lazy chunks | 0 | 2,560 | +2,560 |

The split candidate emits five total files instead of one. The initial saving
is approximately 6.3%, while total gzip grows approximately 11.6%. Without
application splitting, gzip grows approximately 2.6%. Every single-bundle
scenario exceeds its existing budget. Module-request latency, cold import
cancellation races, and browser load failures were not measured.

The candidate passed source TypeScript checking and 97 existing tests across
stream parsing/guards, SSE reconnect, early close, and lifecycle cancellation.
These checks do not establish complete runtime equivalence. The experiment
was rejected on size, then both source files were restored from exact snapshots
of the pre-experiment worktree. Earlier pending fixes were preserved.

## Reproduction

With the pending fixes applied and dependencies installed:

```sh
pnpm build
pnpm benchmark:consumer-size -- --output package-size-results/split-baseline.json
git apply docs/measurements/1.20.0-streaming-split/candidate.patch
pnpm build
pnpm benchmark:consumer-size -- --output package-size-results/split-candidate.json
pnpm benchmark:consumer-size:check package-size-results/split-candidate.json
```

The candidate budget check is expected to fail. Restore and rebuild afterward:

```sh
git apply -R docs/measurements/1.20.0-streaming-split/candidate.patch
pnpm build
```

[Baseline](baseline.json), [candidate](candidate.json), [exact patch](candidate.patch).

A smaller synchronous client would require a distinct public capability boundary:
the current Client exposes all streaming methods and automatically detects
streaming content types. This experiment does not justify removing those
behaviors or changing existing APIs.
