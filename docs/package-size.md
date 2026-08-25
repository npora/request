# Package Size

Package size is a release constraint, separate from runtime performance.
The check covers the transitive file closures loaded by the root and selected
subpath entrypoints, their gzip sizes, declaration files, and the npm tarball.

Build and verify the current package:

```sh
pnpm build
pnpm test:size
```

Generate a machine-readable report:

```sh
pnpm test:size -- --output package-size-results/report.json
```

## Budgets

Budgets live in `test/package/size-budget.json`. They include deliberate
headroom above the measured baseline so that tiny serializer or bundler
differences do not make builds flaky.

The check fails when any raw asset, gzip asset, npm tarball, or unpacked
package exceeds its budget. Do not raise a budget only to make CI pass:
inspect the bundle change, remove accidental code first, and document any
intentional product tradeoff.

The declaration-file budget includes additional headroom for the public retry
lifecycle types introduced in 1.2.0. Version 1.3.0 then raised runtime and
complete-package budgets for the intentional cache store, concurrent request
coordination, and settled lifecycle implementation.

Version 1.4.0 raised the runtime, declaration, and package budgets for the
method-aware MockAdapter router and its deterministic delay, failure, matching,
and history features. No runtime dependency was added.

Version 1.5.0 raised the same budgets for the official circuit-breaker state
machine, bounded half-open concurrency, final-outcome accounting, public types,
and lifecycle observers. The package continues to have zero runtime
dependencies.

Version 1.7.0 raised the ESM, CommonJS, and unpacked-package budgets for the
official concurrency plugin's origin isolation, FIFO queue, cancellation and
timeout cleanup, bounded key retention, public types, and stable overload error
code. Compressed entrypoint and tarball budgets remain unchanged.

Version 1.8.0 raised the compressed ESM and CommonJS budgets for intentional
browser response-size enforcement, bounded stream wrappers, and FormData
nesting protection. Raw entrypoint, declaration, tarball, and unpacked-package
budgets remain unchanged.

Version 1.9.0 raised the compressed entrypoint, declaration, and tarball
budgets for the first-party SSE and NDJSON incremental parsers, async iterator
cancellation, streaming error normalization, public event type, and client
convenience methods. Raw JavaScript and unpacked-package budgets remain
unchanged, and the package still has zero runtime dependencies.

Version 1.10.0 raised the raw and compressed entrypoint, declaration, tarball,
and unpacked-package budgets for the copied Standard Schema v1 protocol types,
schema-aware client overloads, response validation pipeline, and unified
validation error metadata. The feature adds no runtime dependency; the new
limits also account for the synchronized feature, support-policy, and
supply-chain README while retaining measured headroom without hiding larger
future growth.

Versions 1.11.0 through 1.14.0 kept the same budgets while adding native
ordered `URLSearchParams`, retry-aware progress transports, richer progress
events, and backpressure-aware streaming downloads. By 1.14.0 the raw
entrypoints and unpacked package had less than one percent headroom remaining.

Version 1.14.1 minifies the published JavaScript entrypoints after tree
shaking while preserving exported constructor names. The ESM entrypoint
decreased from about 104 kB to 62 kB, its gzip size decreased from about 22.3
kB to 16.9 kB, and the unpacked package decreased from about 292 kB to 208 kB.
Type declarations are unchanged. The JavaScript, tarball, and
unpacked-package budgets were lowered at the same time so this recovered
headroom cannot be consumed accidentally by later features.

Published JavaScript is optimized for machines rather than direct inspection.
Use the tagged repository source when debugging internals; public error names,
codes, metadata, export names, constructor names, and declarations remain
verified package contracts.

Version 1.15.0 split the root bundle into shared ESM and CommonJS chunks and
added core, individual plugin, and testing subpath exports. Size checks follow
each entry's static imports so moving code from an entry wrapper into a shared
chunk cannot make the measured runtime cost appear smaller. The installed
package grows modestly from the extra entry declarations, while applications
can avoid loading unrelated plugins and MockAdapter code.

The conditional cache revalidation change raises the cache subpath, root
runtime, tarball, and unpacked-package budgets by the measured implementation
cost plus narrow headroom. This covers validator retention, conditional request
headers, request cache directives, `304` response restoration, and metadata
merging without adding a runtime dependency; unrelated subpath and declaration
budgets remain fixed.

Bounded stale-if-error recovery adds a small core fallback handoff, the public
request option, cache directive parsing, retry-aware recovery, and strict error
classification. The root, core, cache, declaration, tarball, and unpacked
budgets were raised by the measured cost plus narrow headroom; unrelated plugin
and testing entry budgets remain fixed and no runtime dependency was added.

Stale-while-revalidate adds an internal plugin dispatch channel, immutable
request-input snapshots, deduplicated and abortable background refresh state,
the public request option, and directive parsing. Runtime, declarations,
tarball, and unpacked budgets track the measured implementation cost; no
runtime dependency was added.

Cache observability adds dependency-free aggregate counters and privacy-safe
lifecycle events to the cache subpath. The implementation deliberately omits
request identifiers and isolates observer failures; runtime, declaration, and
package budgets include only the measured feature cost plus narrow headroom.

Targeted cache deletion adds per-key generation isolation, asynchronous store
coordination, in-flight detachment, and background-refresh cancellation. This
keeps unrelated requests cacheable while ensuring older same-key work cannot
repopulate an invalidated entry; budgets track the measured implementation and
public type cost without adding a dependency.

Bounded cache tags add grouped invalidation to the default memory store and an
optional capability for custom stores. Per-key active tag state and per-tag
asynchronous coordination prevent stale in-flight writes without introducing
an unbounded plugin-side index; package budgets include the measured cost.

Successful-mutation invalidation retains bounded request-scoped tag metadata
through retries and performs final-outcome-aware cleanup from the settled
lifecycle. Async stores are awaited and failures remain isolated from an
otherwise successful response; the size budget tracks this orchestration.

IndexedDB cache observability adds current-schema aggregate usage inspection
and privacy-safe eviction, recovery, cleanup, and rejection summaries. The
root, cache, declaration, tarball, and unpacked budgets were raised by the
measured implementation and public type cost plus narrow headroom; no runtime
dependency was added.

IndexedDB admission policies add one synchronous-or-asynchronous decision hook,
strict callback validation, same-key rejection cleanup, and an aggregate event
reason. Runtime, declaration, tarball, and unpacked budgets track the measured
cost plus narrow headroom without affecting unrelated subpaths.

Bounded IndexedDB compaction adds cursor-based maintenance, aggregate cleanup
results, stale-window controls, batch limits, and public option/result types.
The same change makes usage inspection constant-memory. Root, cache,
declaration, tarball, and unpacked budgets track the measured cost plus narrow
headroom; core and unrelated plugin budgets remain fixed.

The final IndexedDB forward-compatibility audit makes reads, deletes, writes,
clearing, compaction, LRU accounting, and quota recovery preserve every higher
schema version even if it occupies an older key or uses an incompatible record
envelope. The root, cache, tarball, and unpacked budgets include only this
measured guard and narrow headroom; declarations and unrelated subpaths remain
fixed.

`pnpm test:package` includes the size check, so release verification cannot
publish a package that exceeds the checked-in budgets. CI also stores the JSON
report for comparing changes over time.
