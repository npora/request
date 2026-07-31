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
lifecycle types introduced in 1.2.0. Runtime JavaScript and complete-package
budgets were not raised for that type-only API growth.

`pnpm test:package` includes the size check, so release verification cannot
publish a package that exceeds the checked-in budgets. CI also stores the JSON
report for comparing changes over time.
