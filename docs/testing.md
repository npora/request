# Testing and release gates

The test strategy verifies behavior at the smallest useful layer and then
repeats critical contracts against the built and published package.

## Local checks

The [Cloudflare Pages website](cloudflare-website.md) has isolated tooling in
`website/`. After `npm ci --prefix website --ignore-scripts`, run
`pnpm test:website` for workerd interface contracts and
`pnpm test:website:browser` for its real Pages console in desktop and mobile
browsers. These tests do not publish npm or deploy Cloudflare resources.

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:types
pnpm test:examples
pnpm example:session
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

IndexedDB record validation, schema classification, byte accounting, and option
validation have Node boundary tests and count toward these thresholds. Database
transactions, cursor maintenance, and the store itself are exercised against
real IndexedDB in Chromium, Firefox, and WebKit rather than a Node simulation.

## Documentation contracts

Run the documentation inventories and their regression tests with:

```sh
pnpm test:docs
node --test test/docs-contract.test.mjs
```

The checks compare source request config field names with the API config blocks
and configuration option tables, public manifest export keys with the API
entrypoint table, public plugin build entries with the README plugin list,
and stable error codes with their documented inventories. Negative fixtures
verify that omissions, additions, duplicates, and obsolete inventory entries
are rejected. The CI quality job runs both commands.

These checks verify inventory coverage. They do not prove that documented
types, defaults, explanations, or runtime behavior are correct; review those
alongside implementation and behavior tests.

## Axios migration contracts

After building, run `pnpm test:migration:axios` with the pinned comparison
fixture installed. The [migration guide](axios-migration.md#compare-real-http-requests)
describes installation, coverage, and limits. This separate Node test suite
compares the built package with Axios HTTP and Fetch adapters over loopback
HTTP; it runs in the CI quality job and is separate from `pnpm test` coverage.

## Feature regression matrix

Run the complete Node suite with `pnpm test:coverage`, then the complete
three-browser suite with `pnpm test:browser`. The rows below identify executable
behavior checks for each feature family; a passing overall coverage percentage
does not replace these checks. Browser-only platform behavior must pass in all
three engines. This inventory covers feature families, not every possible
combination of application callbacks and plugins.

| Feature | Node regression entrypoints | Additional verification |
| --- | --- | --- |
| HTTP methods, data/full responses, client extension | [client](../test/client.test.ts) | Browser client suite; installed Node consumer |
| Native Request/URL and transport options | [request config](../test/request-config.test.ts), [transport config](../test/transport-config.test.ts), [origin](../test/request-origin.test.ts) | Browser native and cross-realm inputs |
| Defaults, headers, queries, JSON/form/multipart bodies | [config merge](../test/config-merger.test.ts), [body guards](../test/body-init-guards.test.ts) | Example typechecks; browser serialization |
| Fetch adapter, parsing and raw response cloning | [Fetch](../test/fetch-adapter.test.ts), [cloning](../test/response-clone.test.ts), [adapter validation](../test/adapter-validation.test.ts) | Installed ESM/CommonJS contracts |
| Request/response size limits | [request size](../test/request-size.test.ts), [stream size](../test/stream-size-lifecycle.test.ts) | Browser limits; installed stream contracts |
| Attempt/total timeout, cancellation and cleanup | [timeout](../test/timeout.test.ts), [signals](../test/timeout-signal.test.ts), [lifecycle cancellation](../test/lifecycle-cancellation.test.ts) | Browser cancellation and early iterator closure |
| Errors and interceptor ordering/failure handling | [errors](../test/request-error.test.ts), [interceptors](../test/interceptor.test.ts), [pipeline errors](../test/pipeline-error.test.ts) | Error workflow; exact documented error-code inventory |
| Plugin installation, removal, dependencies and composition | [plugins](../test/plugin.test.ts), [composition](../test/plugin-composition.test.ts), [session combinations](../test/session-composition.test.ts) | Both auth/cache registration orders; shared refresh cancellation, logout, mutation invalidation, and retry budgets; session and batch workflows |
| Authentication, refresh coalescing and token storage | [auth](../test/auth-plugin.test.ts), [storage](../test/auth-storage.test.ts) | Account isolation and installed session workflows |
| Retry policy, Retry-After, jitter and retry budgets | [retry](../test/retry-plugin.test.ts) | Installed Node consumer and bounded batch workflow |
| HTTP cache, deduplication, validators, stale policies and invalidation | [cache](../test/cache-plugin.test.ts), [unshared revalidation](../test/cache-unshared-revalidation.test.ts) | [Browser credential/integrity/redirect isolation](../browser/tests/cache-transport.spec.ts); browser cache; installed cache consumer |
| Cache refresh lease cancellation/removal | [lease lifecycle](../test/cache-lease-lifecycle.test.ts) | Browser cross-context Web Locks coordination |
| Compact memory cache | [memory cache](../test/memory-cache-plugin.test.ts) | Installed Node consumer |
| Memory/Web Storage/IndexedDB/tiered stores | [cache stores](../test/cache-plugin.test.ts), [IndexedDB boundaries](../test/indexeddb-cache-helpers.test.ts), [tiered stores](../test/tiered-cache-store.test.ts) | Real browser storage, migrations, quotas, broadcast and locks |
| Concurrency, queue overflow, cancellation and permit release | [concurrency](../test/concurrency-plugin.test.ts) | Installed bounded batch workflow |
| Rate limits, rolling windows and shared cooldowns | [rate limits](../test/rate-limit-plugin.test.ts) | Browser client suite |
| Circuit breaker transitions and probes | [circuit breaker](../test/circuit-breaker-plugin.test.ts) | Deterministic state/probe, reset and plugin-removal checks |
| Structured logging and redaction | [logger](../test/logger-plugin.test.ts), [security](../test/security.test.ts) | Observer failures and sensitive-data omission |
| OpenTelemetry spans, propagation and metrics | [traces](../test/opentelemetry-plugin.test.ts), [metrics](../test/opentelemetry-metrics-plugin.test.ts), [official SDK integration](../test/opentelemetry-sdk.integration.test.ts) | Browser W3C propagation and metrics |
| Downloads, progress, stream output and empty bodies | [downloads](../test/download-plugin.test.ts), [progress](../test/download-progress.test.ts), [XHR](../test/download-xhr.test.ts) | Browser Fetch/XHR and stream downloads |
| Uploads, multipart and progress | [uploads](../test/upload-plugin.test.ts), [progress](../test/upload-progress.test.ts) | Native browser XHR uploads |
| SSE/NDJSON parsing, item schema and early closure | [streaming](../test/streaming-response.test.ts), [line parsing](../test/streaming-lines.test.ts), [early closure](../test/stream-early-close.test.ts) | Installed dual-format stream contracts; three-browser streaming |
| SSE reconnect, cursor/retry controls and inherited cancellation | [reconnect](../test/sse-reconnect.test.ts) | Installed dual-format and browser default-signal checks |
| Response/item schema validation and transformation | [schema](../test/schema-validation.test.ts) | Type consumers; browser validators |
| Mock adapter and testing entrypoint | [mock adapter](../test/mock-adapter.test.ts) | Public API/type contracts for testing subpaths |
| Security boundaries and bounded retained state | [security](../test/security.test.ts), [capacity stress](../test/state-capacity-stress.test.ts) | Browser cross-realm and cross-context cases |
| Public exports, package contents and bundling | [package checks](../test/package/manifest.mjs), [API contract](../test/package/api-contract.mjs), [bundle accounting](../test/package/browser-bundle.test.mjs) | Offline installed consumers; runtime CI on Node 22/24/26 |

## Executable onboarding workflows

CI runs the session, account-isolation, Axios migration, error-handling, and
bounded-batch examples, as well as typechecking them. The isolated examples use
native Fetch response fixtures and need no external server or credentials. Run the failure
workflow and documentation contract checks locally:

```sh
node --import tsx examples/errors.ts
node --test test/docs-contract.test.mjs
pnpm test:docs
```

The documentation check parses the source `RequestErrorCode` union and requires
exact matching inventories in README and the API reference. Missing, duplicate,
and obsolete entries fail even when a code is mentioned elsewhere in the prose.

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
- A local tarball installed offline into an isolated Node application, exercising
  native Fetch, retry, cache invalidation, errors, and cancellation.
- Five onboarding workflows compiled to import only public package entries,
  then executed against that installed tarball: Axios migration, session setup,
  account isolation, error recovery, and bounded batches.
- Installed ESM and CommonJS stream contracts covering SSE/NDJSON, item schema
  failures, response size limits, early iteration exit, cancellation, and
  bodyless download streams/progress.
- Raw, gzip, declaration, packed, and unpacked size budgets.

The installed-workflow compiler removes TypeScript syntax and maps each example's
source import to an explicit public entrypoint. Package imports remain external;
metadata checks reject bundled implementation code or unexpected runtime
dependencies. Each child program runs from the temporary installation, so the
repository's source and local package exports cannot accidentally satisfy its
imports. A missing public entry or distribution chunk used by these workflows
fails this check. The existing runtime CI matrix runs the same package suite on Node.js 22, 24,
and 26. Examples continue to run directly against source in the quality job too.

To rerun only the installed consumer checks after building:

```sh
node test/consumer/install.mjs
```

This uses the local tarball and offline installation; the HTTP fixture needs a
loopback listener but does not contact an external service. Child commands have
a 60-second timeout so a broken lifecycle fails instead of hanging indefinitely.
ESM and CommonJS stream checks use injected Fetch response fixtures and the built FetchAdapter.

The registry and offline tarball runners share
[`capability-contract.mjs`](../test/consumer/capability-contract.mjs). In both
ESM and CommonJS, it checks form mapping and prototype-safe keys, SSE reconnect
and early-closure states, malformed lock/channel rejection, and cache operation
without coordination. Thus new entrypoints and lifecycle behavior are checked
against the actual installed artifact, not only source imports.

Both runners also execute [`session-contract.mjs`](../test/consumer/session-contract.mjs)
through public ESM and CommonJS imports. This fixture starts an ephemeral
loopback HTTP server and uses native Fetch, without injecting Fetch or a mock
adapter. It verifies two expired-token requests sharing one refresh, a transient
read retry, account-private cache hits, failed-write cache preservation,
successful-write tag invalidation, view cancellation, logout during refresh,
and logout isolation.
Cancellation must close the corresponding server response; another account's
token and cached list must survive. Gates synchronize the refresh race, and
bounded waits and server cleanup prevent hanging socket fixtures.

This is controlled HTTP integration coverage, not acceptance against an
external production backend or a browser CORS/cookie test. It needs no real
credentials and adds no dependencies to the published library.

The published `latest` package can be tested in an isolated temporary project:

```sh
pnpm test:registry
```

This installs from npm with lifecycle scripts disabled, then verifies both ESM
and CommonJS consumers, including the HTTP session contract above. A scheduled
GitHub Actions matrix repeats the check on Node.js 22, 24, and 26; it can also
be started manually with the **Published Package** workflow. Set
`EXPECTED_PACKAGE_VERSION` to check an exact version rather than `latest`.

## Browser checks

See the [runtime support matrix](runtimes.md) for the workerd, Service Worker,
Undici, and unverified-platform boundaries. `pnpm test:edge` requires the
isolated `test/edge` fixture installed with `npm ci --ignore-scripts`; the CI
quality job installs, audits and executes it. Service Worker contracts run as
part of the normal three-browser suite.

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
```

Playwright validates Chromium, Firefox, and WebKit, including native Fetch
inputs, SSE and NDJSON streaming, W3C trace-context header injection, Web
Workers, plugin lifecycle, HEAD/OPTIONS/QUERY, and concurrent XHR
upload/download progress. A minified application bundle imported through the
package exports also checks cache clearing, errors, and cancellation in all
three browsers.

The [cross-origin session suite](../browser/tests/session-cross-origin.spec.ts)
bundles a consumer using public package exports and starts a separate, ephemeral
HTTP API. It verifies an HttpOnly refresh cookie with `credentials: 'include'`,
real CORS preflights, missing-cookie 401 responses, and rejection of an invalid
CORS response. Two expired requests share one refresh; cancelling one waiter
leaves the survivor active. Logout must disconnect both a pending request and
the refresh transport, clear the application's access token, and leave another
browser context's account and cached response intact.

The refresh is held behind a server gate until both callers have joined. The
suite uses bounded polling rather than timing sleeps and closes all servers
and browser contexts. The account facade handles session disposal; the library
does not implement login/logout or delete HttpOnly cookies. These tests use
same-site localhost origins on different ports. They cover cross-origin Fetch,
not third-party cookie policies or production TLS/SameSite deployment settings.
They exercise the local build; the installed-package HTTP tests above verify
published artifacts separately.

```sh
pnpm test:browser --grep 'cross-origin cookie|logout cancels a pending'
```

## Performance checks

```sh
pnpm benchmark
pnpm benchmark:streaming
pnpm benchmark:check -- \
  --budget benchmark/performance-budget.json \
  --request .artifacts/benchmarks/request.json \
  --streaming .artifacts/benchmarks/streaming-schema.json
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

## Layered stress checks

Run correctness tests and browser checks first, then run the following workloads
sequentially so simultaneous benchmark processes do not distort each other's
latency and throughput:

```sh
pnpm stress -- --operations 10000000 --concurrency 64 --output .artifacts/benchmarks/stress-10m-c64.json
pnpm stress -- --operations 1000000 --concurrency 256 --output .artifacts/benchmarks/stress-1m-c256.json
pnpm benchmark:http -- --operations 100000 --concurrency 256 --output .artifacts/benchmarks/http-100k-c256.json
pnpm benchmark:streaming -- --operations 1000000 --output .artifacts/benchmarks/streaming-schema.json
pnpm benchmark:streaming-lines -- --output .artifacts/benchmarks/streaming-lines.json
```

The mixed stress runner distributes logical operations across 28 scenarios:
core/configuration, interceptors, cache hits/shared misses/clear races,
concurrency queues, rate limits, tracing/metrics, circuit transitions, retry,
auth refresh, cancellation, schemas, uploads/downloads, streaming, and mixed or
disabled plugins. It asserts operation counts and zero unexpected failures.
It uses controlled adapters and Fetch/XHR fixtures, so its logical-operation
throughput is not an HTTP network-throughput claim. Some scenarios constrain
their own concurrency to verify a specific lifecycle contract.

The HTTP benchmark uses a real loopback server and checks the received request
count, including warmup. Streaming checks ordered checksums, slow consumers,
schema/consumer cancellation, and pre/post-GC heap growth. Fragmented long-line
checks verify content at multiple sizes and report timings without imposing an
absolute latency ceiling. Retained heap and sampled latency/RSS metrics are
diagnostic evidence; a single finite stress run cannot prove absence of leaks
or predict production latency across remote services and machines.

## Release process

Every user-visible change includes a Changesets entry. CI verifies Node.js 22,
24, and 26 plus the public type, quality, and browser suites. The release
workflow runs only after the exact `main` commit completes that matrix
successfully. Merging the generated version PR then publishes to npm with
trusted publishing and creates a Git tag and GitHub Release. A separate
`Verify published package` job installs the exact version for ESM and CommonJS
capability and HTTP session checks. It receives the published version through job outputs, checks out
the same release commit, and has only repository read permission. When creating
a version PR without publishing, this verification job is skipped.

Registry metadata can lag behind an accepted publish. Installation retries
only npm `ETARGET` and `E404` failures, with 15 minutes of scheduled waits and
a maximum 30-second interval. Each install or smoke-test command has a two-minute
timeout, and the verification job has a 30-minute deadline. Command time adds
to the scheduled waits; killed commands and other failures stop immediately.
After a propagation failure, use GitHub Actions **Re-run failed jobs** to repeat
the verification job while retaining the successful publish job and its exact
version output. Do not republish or bump a version just to rerun verification.

The release workflow uses Changesets CLI v3 with an immutable-pinned
Changesets Action v2. Run `pnpm test:release-workflow` after changing release
automation; it verifies the CLI/config generation, action pin, token input,
and v2 input names. Changes limited to verification or development tools do not
require a published package version bump.
