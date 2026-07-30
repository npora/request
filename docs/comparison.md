# Request Library Comparison

This is a dated engineering snapshot, not a permanent ranking.

Snapshot date: 2026-07-30.

Ten active, high-visibility GitHub projects were selected to cover the main
JavaScript HTTP-client designs. A strict star ranking would mix full clients,
Fetch wrappers, and low-level transports, so it would not produce a useful
like-for-like list.

## Projects

| Project | Tested version | Runtime and focus | Direct dependencies |
| --- | ---: | --- | ---: |
| Npora Request | local | Browser, Node, Worker; Fetch-first extensible client | 0 |
| [Axios](https://github.com/axios/axios) | 1.18.1 | Browser and Node; adapter-based full client | 4 |
| [Ky](https://github.com/sindresorhus/ky) | 2.0.2 | Modern Fetch runtimes; compact typed client | 0 |
| [Got](https://github.com/sindresorhus/got) | 15.1.0 | Node; feature-rich native HTTP client | 12 |
| [ofetch](https://github.com/unjs/ofetch) | 1.5.1 | Browser, Node, Worker; universal Fetch wrapper | 3 |
| [Wretch](https://github.com/elbywan/wretch) | 3.0.9 | Modern Fetch runtimes; fluent addon-based client | 0 |
| [SuperAgent](https://github.com/forwardemail/superagent) | 10.3.0 | Browser and Node; fluent full client | 9 |
| [Needle](https://github.com/tomas/needle) | 3.5.0 | Node; compact native HTTP client | 2 |
| [redaxios](https://github.com/developit/redaxios) | 0.5.1 | Fetch runtimes; small Axios-compatible subset | 0 |
| [node-fetch](https://github.com/node-fetch/node-fetch) | 3.3.2 | Node; Fetch-compatible transport primitive | 3 |
| [Undici](https://github.com/nodejs/undici) | 8.9.0 | Node; HTTP transport and Fetch foundation | 0 |

Dependency counts come from each installed package manifest and exclude
transitive dependencies. All ten packages were uninstalled after the
evaluation.

## Equivalent Workload

The confirmation run used:

- Node.js 24.18.0 on Darwin arm64.
- One local HTTP/1.1 server.
- The same GET path, two query parameters, request headers, and JSON payload.
- 50 warm-up operations per client.
- 500 measured operations per scenario.
- Sequential and concurrency-50 scenarios.
- Five samples with rotated client order.
- The median-throughput sample, not the best run.

The server asserted the method, path, query, and identifying header for every
request. Every client parsed the response JSON before an operation completed.

## Confirmation Results

| Client | Sequential ops/s | Concurrent ops/s | Concurrent p95 |
| --- | ---: | ---: | ---: |
| Native Fetch | 806 | 18,161 | 6.251 ms |
| **Npora Request** | **807** | **17,336** | **5.950 ms** |
| Axios | 9,201 | 11,255 | 8.284 ms |
| Ky | 791 | 12,182 | 7.656 ms |
| Got | 8,854 | 11,291 | 7.306 ms |
| ofetch | 799 | 17,493 | 3.593 ms |
| Wretch | 800 | 17,007 | 6.195 ms |
| SuperAgent | 8,096 | 10,999 | 7.564 ms |
| Needle | 9,251 | 10,985 | 5.213 ms |
| redaxios | 805 | 15,555 | 7.107 ms |
| node-fetch | 9,826 | 11,998 | 8.669 ms |
| Undici | 805 | 19,276 | 3.291 ms |

The smaller three-sample run showed the same broad split and kept Npora in the
leading concurrent group.

## Interpretation

Sequential localhost numbers split sharply by transport family. Native Node
HTTP clients and node-fetch completed the tight sequential loop much faster
than the Node 24 Fetch family, while Fetch-based clients clustered around the
same result. This is a transport scheduling and connection-reuse observation,
not evidence that one client will make internet requests ten times faster.

Concurrency is more representative of application pressure. Npora reached
95% of native Fetch throughput, stayed within 1% of ofetch, slightly exceeded
Wretch, and delivered about 54% more throughput than Axios in this run.
These values remain machine-specific and must not become CI thresholds.

Heap deltas were intentionally excluded from the table. Garbage collection
made their sign and magnitude unstable between rotated samples.

## Architecture Decisions

1. Keep FetchAdapter as the default. It delivers competitive concurrent
   behavior across Browser, Node, and Worker without runtime dependencies.
2. Do not add a Node Adapter solely to improve a localhost microbenchmark.
   A second transport is justified only by concrete proxy, dispatcher,
   HTTP/2, or connection-control requirements.
3. Keep the package-size and pipeline benchmarks as release gates and trend
   reports. Do not ship competitor libraries or run cross-library installs in
   CI.
4. Prioritize consistent lifecycle behavior, typed extensions, progress
   fallback, cancellation cleanup, and tail latency over winning a single
   throughput sample.

## Limitations

- The test used localhost, not real DNS, TLS, packet loss, or remote servers.
- Each library used its current default Node transport where practical.
- Query construction APIs differ; Wretch and transport primitives received a
  prebuilt URL because their current core APIs do not expose the same query
  helper.
- Feature breadth, bundle size, API ergonomics, and ecosystem maturity are
  separate from request throughput.
- Package releases and runtime implementations will change after this
  snapshot.
