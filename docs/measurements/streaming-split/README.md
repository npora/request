# Streaming parser split investigation

Decision: retain synchronous module loading in the shipped implementation.
Moving SSE/NDJSON parsers behind a dynamic import does not provide enough initial
bundle savings in this experiment to justify its total cost and extra module-load
boundary. This is a measured decision about this parser-only split, not evidence
that every possible client or streaming split would have the same result.

## Experiment

The source baseline is commit `82fbcb433f1c4447dae13df7b519422f9ff9295f`,
package version 1.19.3. The candidate changes only `parseResponse.ts` to load
`parseStreamingResponse` when SSE/NDJSON is requested or detected. It leaves
native ReadableStream handling and the public API intact. The
[exact candidate patch](../../../benchmark/experiments/lazy-streaming.patch) is
an experimental artifact and is not applied to the shipped source.

Both reports were produced on Node.js 24.18.0 / Apple M3 arm64 with esbuild
0.28.2, minified browser ESM targeting ES2020, gzip level 9. Each scenario is built
both with and without esbuild splitting. Initial cost follows every static import
from the application entry, including shared chunks. Total cost includes every
emitted chunk, each compressed separately. This is emitted JavaScript body size;
HTTP headers and module-request latency are not measured.

Reports correctly record `gitDirty: true`: the measurement tools were being
edited, and the candidate temporarily changes one source file. The baseline
build hash matches the [clean 1.19.3 report](../1.19.3/consumer.json); the candidate
patch and different build hash identify the experimental source. The root
lockfile did not change. The patch SHA-256 is
`6ab85c7fac317189bba29f58bad9a5b016c91493582946d9690f98f2cda45a71`.

## Core basic results

| Measurement | Baseline gzip bytes | Candidate gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Single bundle | 13,889 | 14,140 | +251 (+1.8%) |
| Split initial static closure | 13,889 | 13,662 | -227 (-1.6%) |
| All split chunks | 13,889 | 14,870 | +981 (+7.1%) |
| Lazy-only chunks | 0 | 1,208 | +1,208 |

Initial requests use one emitted file in the baseline and two in the candidate;
streaming adds a third candidate file. Consumers that do not split chunks grow
rather than shrink. Even with splitting, the 227-byte initial saving is small
relative to the added load boundary and total gzip growth. The candidate also
exceeds the existing consumer budgets; budgets were not increased.

The uncompressed stream parser chunk is 2,408 bytes, but the initial saving is
only 227 compressed bytes because code shared with the initial lifecycle remains
in static chunks and separately compressed chunks lose dictionary sharing. A
module's presence in a large build chunk did not mean the entire chunk could be
removed from ordinary requests.

## Validation and reproduction

The candidate passed TypeScript checking and 89 existing tests across streaming
responses, fragmented lines, early iterator closure, SSE reconnection, schema
validation, and lifecycle cancellation. These checks do not prove all browser
module-load failures or cancellation races across a cold import. Since the
candidate is not shipped, no new runtime contract is introduced.

In a clean checkout with installed development dependencies, generate a baseline:

```sh
pnpm build
pnpm benchmark:consumer-size -- --output package-size-results/split-baseline.json
```

Apply the experimental patch, rebuild, and measure again:

```sh
git apply --check benchmark/experiments/lazy-streaming.patch
git apply benchmark/experiments/lazy-streaming.patch
pnpm build
pnpm benchmark:consumer-size -- --output package-size-results/split-candidate.json
```

Restore the source and rebuild after the experiment:

```sh
git apply -R benchmark/experiments/lazy-streaming.patch
pnpm build
```

- [Raw baseline, seven scenarios](baseline.json)
- [Raw candidate, seven scenarios](candidate.json)

The consumer budget checker now validates initial/lazy/total accounting and
applies the existing gzip ceiling to all emitted split chunks as well as to the
single bundle. Its regression test includes a passing initial bundle with an
oversized lazy chunk. Future experiments must report both costs.

The next useful size investigation is the Client method surface and shared
response machinery, with before/after consumer measurements. A separate minimal
client entry would need an explicit scope and API proposal; this experiment does
not justify changing the existing core entry's behavior.
