# Package Size

Package size is a release constraint, separate from runtime performance.
The check covers both published JavaScript entrypoints, their gzip sizes,
declaration files, and the npm tarball.

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

`pnpm test:package` includes the size check, so release verification cannot
publish a package that exceeds the checked-in budgets. CI also stores the JSON
report for comparing changes over time.
