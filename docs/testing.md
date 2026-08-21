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

Playwright validates Chromium, Firefox, and WebKit, including Fetch requests,
SSE and NDJSON streaming, Web Workers, plugin lifecycle, HEAD/OPTIONS, and
concurrent XHR upload/download progress.

## Performance checks

```sh
pnpm benchmark
pnpm test:size
```

Benchmarks are trend reports rather than fixed pass/fail throughput thresholds.
Package size budgets are release-blocking.

## Release process

Every user-visible change includes a Changesets entry. CI verifies Node.js 22,
24, and 26 plus the quality and browser suites. Merging the generated version
PR publishes to npm with trusted publishing, creates a Git tag, and creates a
GitHub Release.

The release workflow uses Changesets CLI v3 with an immutable-pinned
Changesets Action v2. Run `pnpm test:release-workflow` after changing release
automation; it verifies the CLI/config generation, action pin, token input,
and v2 input names. Infrastructure-only changes use an empty changeset and do
not bump the published package version.
