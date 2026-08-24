# HTTP client comparison

This is a dated engineering snapshot, not a permanent ranking. Project
versions, repository activity, package contents, and runtime capabilities will
change.

Snapshot date: 2026-08-24.

## Projects

| Project | Version | GitHub stars | Runtime focus | Runtime dependencies | npm unpacked size |
| --- | ---: | ---: | --- | ---: | ---: |
| Npora Request | 1.14.3 | 0 | Browser, Node, and Worker; Fetch-first resilient client | 0 | 233 kB |
| [Axios](https://github.com/axios/axios) | 1.19.0 | 109,198 | Browser and Node; multi-adapter full client | 4 | 1,868 kB |
| [Ky](https://github.com/sindresorhus/ky) | 2.0.2 | 17,032 | Modern Fetch runtimes; compact typed client | 0 | 405 kB |
| [Got](https://github.com/sindresorhus/got) | 15.1.0 | 14,930 | Node; feature-rich native HTTP client | 12 | 371 kB |
| [ofetch](https://github.com/unjs/ofetch) | 1.5.1 | 5,352 | Browser, Node, and Worker; universal Fetch wrapper | 3 | 64 kB |

Stars are useful evidence of ecosystem reach, not code quality. npm unpacked
sizes are package-manager metadata and are not directly comparable to the
amount of code retained by an application bundler.

## Capability matrix

| Capability | Npora Request | Axios | Ky | Got | ofetch |
| --- | --- | --- | --- | --- | --- |
| Browser, Node, and Worker | Yes | Browser and Node; adapter dependent | Yes | Node only | Yes |
| CommonJS package export | Yes | Yes | No | No | Yes |
| Zero runtime dependencies | Yes | No | Yes | No | No |
| Standard Schema validation | Yes | No built-in contract | Yes | No built-in contract | No built-in contract |
| Built-in retry | Plugin | No | Yes | Yes | Yes |
| Extensible response cache | Plugin | No | No | Yes | No |
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

- Axios 1.19.0 fixed immediate propagation of already-aborted signals,
  synchronous interceptor failures that could still dispatch, final streamed
  download progress ordering, proxy bypass matching, and response-size
  enforcement for base64 data URLs. Its release history demonstrates mature
  coverage, but also shows why adapter/interceptor combinations need their own
  cancellation and security regression tests. See the official
  [Axios 1.19.0 release notes](https://github.com/axios/axios/releases/tag/v1.19.0).
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
the 10,000,000-operation in-memory matrix with real HTTP integration tests and
multi-browser XHR/stream coverage; production limits still depend on payload
size, remote latency, runtime Fetch/XHR behavior, proxy topology, and retry
idempotency.

## Product direction

Npora Request should not duplicate every Node transport feature or compete on
star count through feature volume. Its useful position is a portable,
TypeScript-first request lifecycle for applications that need validation,
streaming, resilience, and deterministic extensions together.

Future transport-specific work should be driven by concrete proxy,
dispatcher, HTTP/2, or connection-management requirements. Package
modularity, migration guidance, cache correctness, and observability offer
more value than adding another isolated convenience option.
