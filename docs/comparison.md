# HTTP client comparison

This is a dated engineering snapshot, not a permanent ranking. Project
versions, repository activity, package contents, and runtime capabilities will
change.

Snapshot date: 2026-08-21.

## Projects

| Project | Version | GitHub stars | Runtime focus | Runtime dependencies | npm unpacked size |
| --- | ---: | ---: | --- | ---: | ---: |
| Npora Request | 1.14.2 | 0 | Browser, Node, and Worker; Fetch-first resilient client | 0 | 224 kB |
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

## Product direction

Npora Request should not duplicate every Node transport feature or compete on
star count through feature volume. Its useful position is a portable,
TypeScript-first request lifecycle for applications that need validation,
streaming, resilience, and deterministic extensions together.

Future transport-specific work should be driven by concrete proxy,
dispatcher, HTTP/2, or connection-management requirements. Package
modularity, migration guidance, cache correctness, and observability offer
more value than adding another isolated convenience option.
