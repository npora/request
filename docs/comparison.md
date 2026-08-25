# HTTP client comparison

This is a dated engineering snapshot, not a permanent ranking. Project
versions, repository activity, package contents, and runtime capabilities will
change.

Snapshot date: 2026-08-25.

## Projects

| Project | Version | Runtime focus | Runtime dependencies | Best fit |
| --- | ---: | --- | ---: | --- |
| Npora Request | Next, based on 1.14.4 | Browser, Node, and Worker | 0 | Typed Fetch lifecycle with validation, streaming and composable resilience |
| [Axios](https://github.com/axios/axios/releases/tag/v1.20.0) | 1.20.0 GitHub release; 1.19.0 npm benchmark | Browser and Node; multiple adapters | 4 | Established ecosystem and Node compatibility controls |
| [Ky](https://github.com/sindresorhus/ky/releases/tag/v2.0.2) | 2.0.2 | Modern Fetch runtimes | 0 | Small, elegant Fetch convenience client |
| [Got](https://github.com/sindresorhus/got/releases/tag/v15.1.0) | 15.1.0 | Node only | 12 | Deep Node HTTP/2, proxy, pagination and socket control |
| [ofetch](https://github.com/unjs/ofetch/releases/tag/v1.5.1) | 1.5.1 | Browser, Node, and Worker | 3 | Lightweight universal parsing, retry and hooks |

Versions and direct runtime dependency counts come from the projects' official
GitHub releases and package manifests: [Axios](https://github.com/axios/axios/blob/v1.x/package.json),
[Ky](https://github.com/sindresorhus/ky/blob/main/package.json),
[Got](https://github.com/sindresorhus/got/blob/main/package.json), and
[ofetch](https://github.com/unjs/ofetch/blob/main/package.json). They can change
after this snapshot.

## Capability matrix

| Capability | Npora Request | Axios | Ky | Got | ofetch |
| --- | --- | --- | --- | --- | --- |
| Browser, Node, and Worker | Yes | Browser and Node; adapter dependent | Yes | Node only | Yes |
| CommonJS package export | Yes | Yes | No | No | Yes |
| Zero runtime dependencies | Yes | No | Yes | No | No |
| Standard Schema validation | Yes | No built-in contract | Yes | No built-in contract | No built-in contract |
| Built-in retry | Plugin | No | Yes | Yes | Yes |
| Extensible response cache | Memory, Web Storage, IndexedDB and tiered stores | No | No | Yes | No |
| Persistent-cache budgets, admission and compaction | Yes | No | No | Store dependent | No |
| Circuit breaker | Plugin | No | No | No | No |
| Concurrency queue | Plugin | No | No | No | No |
| Parsed SSE and NDJSON | Yes | Raw stream | Raw stream | Raw stream | Raw stream |
| Upload/download progress | Yes | Yes | Yes | Yes | Raw stream hooks |
| HTTP/2, proxy, socket control | Custom adapter required | Node adapter | Fetch runtime dependent | Yes | Fetch runtime dependent |

The table describes first-party APIs in the compared packages. External
plugins, platform APIs, and application wrappers can add capabilities to every
client.

## Where Npora Request is strongest

- Resilience features share one deterministic plugin lifecycle rather than
  being implemented independently by application interceptors.
- Standard Schema validation preserves typed response and error metadata.
- SSE, NDJSON, and file downloads remain incremental and cancellation-aware.
- The same public behavior is tested across browsers, workers, Node.js, ESM,
  and CommonJS without runtime dependencies.
- Cache behavior includes conditional revalidation, stale recovery, bounded
  tags, request deduplication, cross-tab invalidation/coalescing, byte budgets,
  schema isolation, admission policies, usage metrics, and bounded compaction.
- Concurrency limiting and circuit breaking are first-party lifecycle plugins,
  so cancellation, retry and final-outcome accounting are tested together.

## Where established clients are stronger

- Axios has much greater adoption, more integrations, and mature Node adapter
  behavior for proxies, redirects, agents, and compatibility edge cases.
- Ky offers a smaller conceptual API and has first-party Standard Schema,
  retry, timeout, and progress support for modern Fetch applications.
- Got provides Node-specific HTTP/2, proxy, pagination, cache, timing, and
  connection controls that a portable Fetch-first client cannot expose
  consistently.
- ofetch is substantially smaller when an application only needs convenient
  parsing, retries, query parameters, and hooks.

## Concurrency and operational risk notes

- Axios 1.20.0 hardened runtime option reads, trimmed ejected interceptor
  storage, fixed XHR navigation cancellation and final progress delivery, and
  removed pooled-socket request-context retention. Its mature adapter coverage
  remains a major strength, while the fixes illustrate why cancellation,
  interceptor and resource-retention combinations need dedicated regression
  tests. See the official
  [Axios 1.20.0 release notes](https://github.com/axios/axios/releases/tag/v1.20.0).
- Ky retries by cloning request bodies with `ReadableStream.tee()`. Its official
  documentation warns that a retried streaming upload may be buffered entirely
  in memory; large uploads should disable retries or use a replayable body.
  Chromium can also perform its own 408 retry in addition to Ky's retry. See
  [Ky retry documentation](https://github.com/sindresorhus/ky#retry).
- Got is the strongest comparison here for Node transport control, but v15 is
  Node 22+ and ESM-only. HTTP/2 is opt-in, and supplying a custom HTTPS agent
  bypasses Got's built-in HTTP/2 behavior. See the official
  [Got repository](https://github.com/sindresorhus/got) and
  [options documentation](https://github.com/sindresorhus/got/blob/main/documentation/2-options.md).
- ofetch retries once by default for eligible failures but avoids automatic
  retry for mutating methods unless configured. That is a safer default for
  non-idempotent writes, while applications still need replayability and
  idempotency controls for any enabled upload retry. See the official
  [ofetch documentation](https://github.com/unjs/ofetch#%EF%B8%8F-auto-retry).
- Npora Request's first-party queue and circuit breaker reduce the amount of
  application coordination code, but they also create shared mutable state.
  Bounded keys/queues, plugin uninstall, synchronous abort registration,
  timeout cleanup, half-open probe limits, and upload/download backpressure are
  therefore release-gated rather than treated as incidental plugin behavior.

No synthetic benchmark proves network correctness. The comparison combines
the 10,000,000-operation, 256-worker in-memory matrix, a separate 100,000-request
localhost HTTP run at concurrency 256, real integration tests, and
multi-browser XHR/stream coverage.

An additional isolated localhost benchmark executed three rotated rounds of
30,000 JSON requests per client at concurrency 128. Median throughput was
22,653 req/s for ofetch 1.5.1, **22,390 req/s for Npora Request**, 18,048 for Ky
2.0.2, 14,638 for Axios 1.19.0 (the current npm release during the run), and
13,672 for Got 15.1.0. Npora Request was within 1.2% of the fastest result while
retaining its full default response lifecycle. This local result is not a
universal speed ranking: transport implementations differ, and production
limits depend on payload size, remote latency, runtime Fetch behavior, proxy
topology, and retry idempotency. The exact method and per-round reporting are
documented in [Performance Benchmarks](benchmark.md).

## Product direction

Npora Request should not duplicate every Node transport feature or compete on
star count through feature volume. Its useful position is a portable,
TypeScript-first request lifecycle for applications that need validation,
streaming, resilience, and deterministic extensions together.

Future transport-specific work should be driven by concrete proxy,
dispatcher, HTTP/2, or connection-management requirements. Package
modularity, migration guidance, cache correctness, and observability offer
more value than adding another isolated convenience option.
