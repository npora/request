# Testing and release gates

The test strategy verifies behavior at the smallest useful layer and then
repeats critical contracts against the built and published package.

## Local checks

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:types
pnpm test:examples
pnpm benchmark:types
pnpm benchmark:streaming
```

Coverage thresholds are:

| Metric | Minimum |
| --- | ---: |
| Statements | 85% |
| Branches | 80% |
| Functions | 90% |
| Lines | 85% |

## Security checks

```sh
pnpm test:security
pnpm audit:dependencies
pnpm audit:signatures
```

The security regression suite covers configuration validation before network
I/O, header injection, inherited property handling, prototype pollution,
credential/query redaction, auth-aware caching, and secret omission from logs.

The dependency audit fails on high or critical advisories. Signature
verification checks registry signatures for installed packages.

## Package checks

```sh
pnpm build
pnpm test:package
```

Package verification covers:

- ESM and CommonJS consumption.
- Exact runtime and TypeScript export contracts.
- Black-box public behavior.
- npm tarball file allowlist.
- Raw, gzip, declaration, packed, and unpacked size budgets.

The published `latest` package can be tested in an isolated temporary project:

```sh
pnpm test:registry
```

This installs from npm with lifecycle scripts disabled, then verifies both ESM
and CommonJS consumers. A scheduled GitHub Actions matrix repeats the check on
Node.js 22, 24, and 26.

## Browser checks

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
```

Playwright validates Chromium, Firefox, and WebKit, including native Fetch
inputs, SSE and NDJSON streaming, W3C trace-context header injection, Web
Workers, plugin lifecycle, HEAD/OPTIONS/QUERY, and concurrent XHR
upload/download progress.

## Performance checks

```sh
pnpm benchmark
pnpm benchmark:streaming
pnpm benchmark:check -- \
  --budget benchmark/performance-budget.json \
  --request benchmark-results/request.json \
  --streaming benchmark-results/streaming-schema.json
pnpm test:size
```

The request benchmark measures GET, JSON body construction, plugin pipelines,
cache hits, rate limiting, and the non-streaming OpenTelemetry Metrics fast
path. The streaming benchmark lazily validates one million NDJSON items and
one million SSE items, forces records across chunk
boundaries, yields to a slow consumer, and verifies schema-failure and consumer
cancellation propagation.

CI enforces conservative ratios against same-process baselines instead of
hardware-specific absolute request throughput. Streaming has low absolute
floors plus exact record, ordered checksum, slow-consumer, bounded heap-growth,
and cancellation contracts. Budgets live in
`benchmark/performance-budget.json`; reports remain CI artifacts for trend
analysis. Package size and performance budgets are release-blocking.

The Node suite also runs pairwise composition scenarios across cache, auth,
rate limiting, concurrency, retry, circuit breaking, and telemetry. A separate
integration test uses the official OpenTelemetry API and SDK exporters so the
structural adapters are not validated only against duck-typed test doubles.
`pnpm test:complexity` blocks production-file, function-complexity, and nesting
growth; the package contract and size suites continue to gate public API and
root-entry transitive gzip growth.

## Release process

Every user-visible change includes a Changesets entry. CI verifies Node.js 22,
24, and 26 plus the public type, quality, and browser suites. The release
workflow runs only after the exact `main` commit completes that matrix
successfully. Merging the generated version PR then publishes to npm with
trusted publishing, creates a Git tag and GitHub Release, and immediately
installs the exact published version for ESM and CommonJS smoke tests.

The release workflow uses Changesets CLI v3 with an immutable-pinned
Changesets Action v2. Run `pnpm test:release-workflow` after changing release
automation; it verifies the CLI/config generation, action pin, token input,
and v2 input names. Infrastructure-only changes use an empty changeset and do
not bump the published package version.
