# Performance Benchmarks

The core benchmark measures request-library overhead without network latency.
It uses a minimal stateless adapter, a warm-up phase and the same workload for
every scenario. Separate HTTP and competitor benchmarks use a localhost server.
The core adapter intentionally omits request history so test-only observability
storage is not mistaken for production request overhead during long stress
runs.

Run the default benchmark:

```sh
pnpm benchmark
```

Generate a machine-readable report:

```sh
pnpm benchmark -- --output benchmark-results/request.json
```

Tune the workload:

```sh
pnpm benchmark -- \
  --operations 10000 \
  --concurrency 100 \
  --warmup 500
```

Run the bounded full-feature stress matrix (10,000,000 logical operations by
default):

```sh
pnpm stress -- --output benchmark-results/stress.json
```

Run a separate real localhost HTTP concurrency test:

```sh
pnpm benchmark:http -- \
  --operations 100000 \
  --concurrency 256 \
  --output benchmark-results/http.json
```

Run the isolated request-library comparison after installing its locked
dependencies:

```sh
pnpm benchmark:libraries:install
pnpm build
pnpm benchmark:libraries -- \
  --operations 10000 \
  --concurrency 128 \
  --warmup 100 \
  --rounds 3 \
  --scenarios get-json,post-json,query-json
```

The comparison reads installed library versions instead of embedding version
labels. Its local server verifies every method, serialized request body, and
content type before counting a request, so a fast but semantically different
request fails the run. Scenario order rotates between rounds, and the JSON
report records raw samples plus median throughput and latency. Use smaller
operation and round counts for smoke tests; compare full reports only on the
same runtime and machine.

The stress runner distributes an exact total across core dispatch,
serialization, interceptors, cache hits, deduplication and clear races, immediate and
contended concurrency, queued cancellation, closed and transitioning circuits,
one-retry requests, authentication, asynchronous extension cancellation,
logging, Standard Schema, expected errors,
pre-aborted signals, Fetch/XHR upload and download progress, SSE, NDJSON, and a
mixed plugin pipeline. Latencies are bounded samples rather than a ten-million
element allocation. With `--expose-gc`, retained heap is measured after each
scenario while peak RSS records transient runtime pressure.

On 2026-08-25, Node.js 24.18.0 on Darwin arm64 completed the final matrix with
256 workers in 19.84 seconds with zero unexpected failures. It included 1,200,000
adapter attempts for 600,000 retrying requests, 4,655 adapter attempts for 400,000
deduplicated cache requests, 100,000 cache-clear races covering 200,000 callers,
100,000 asynchronous circuit-failure classifications, 100,000 shared auth
refresh/cancellation operations, 100,000 initial-auth/cache/retry/circuit async
extension cancellations, 100,000 events for each upload/download progress path,
and 150,000 parsed SSE/NDJSON records. These are in-memory transport stress
results, not network throughput claims.

Key 256-worker in-memory results from that run:

| Scenario | Operations | Throughput | Sampled p99 | Failures |
| --- | ---: | ---: | ---: | ---: |
| Bare core dispatch | 1,600,000 | 9,370,964 ops/s | 0.087 ms | 0 |
| Immediately admitted concurrency | 700,000 | 2,396,071 ops/s | 0.200 ms | 0 |
| Single-permit FIFO contention | 600,000 | 778,637 ops/s | 0.666 ms | 0 |
| Cache miss deduplication | 400,000 | 455,677 ops/s | 1.401 ms | 0 |
| Queue cancellation | 200,000 | 225,874 ops/s | 3.961 ms | 0 |

The full run's maximum sampled scenario RSS was 388.42 MiB and its largest
post-GC retained heap delta was 0.88 MiB. These values include Node, Fetch/XHR
test doubles, payload objects, latency samples, and runtime allocator behavior.

The separate localhost run sent 100,000 actual HTTP requests through the
native Node Fetch transport with concurrency 256. The server received every
request; throughput was 21,029 requests/s, sampled p50 was 10.627 ms, p95 was
15.808 ms, and p99 was 17.624 ms. This loopback result includes sockets, HTTP
parsing, body streaming, and JSON parsing, but still does not predict remote
service latency or production proxy/TLS behavior.

## Scenarios

- `directAdapter`: adapter-only control measurement.
- `sequentialClient`: complete client pipeline, one request at a time.
- `bareSequentialClient`: method shortcut without client defaults or request
  options, measuring the minimum validated Client path.
- `jsonBodySequentialClient`: method shortcut replacing a default JSON body
  with a request JSON body.
- `sequentialPluginPipeline`: sequential client with synchronous request and
  response interceptors plus request and response plugin hooks.
- `singleAsyncHookLifecycleClient`: sequential client with one asynchronous
  request, transport, response, and settled hook per lifecycle stage.
- `concurrentClient`: complete client pipeline with bounded concurrency.
- `concurrentPluginPipeline`: concurrent client with request/response
  interceptors and request/response plugin hooks.
- `cacheHitClient`: repeated data reads from the default in-memory cache.
- `cachePrimitiveHitClient`: repeated immutable string reads from the default
  in-memory cache.
- `cacheMissClient`: repeated cacheable requests with persistence disabled,
  covering miss registration and response handling.
- `cacheDedupeClient`: concurrent cache misses sharing one leader response.
- `cacheClearRaces`: concurrent data-only and complete-response leader/follower
  pairs detached from the cache generation before their adapters settle.
- `concurrencyImmediateClient`: sequential requests admitted immediately by
  the concurrency plugin without queueing.
- `concurrencyContendedClient`: concurrent requests serialized through one
  concurrency permit and its FIFO wait queue.
- `circuitBreakerSuccessClient`: successful requests tracked by a closed
  circuit breaker.
- `circuitAsyncPolicy`: repeated open/half-open cycles whose counted failure
  policy yields asynchronously while probe admission remains bounded.
- `concurrencyBaseClient`: immediately admitted concurrency-plugin requests
  resolved against an absolute base URL.
- `circuitBreakerBaseClient`: successful circuit-breaker requests resolved
  against an absolute base URL.
- `authStaticTokenClient`: requests authorized by the authentication plugin
  with a static token.
- `authBareTokenClient`: static-token authentication without pre-existing
  request headers.
- `authRefreshCancellation`: concurrent 401 responses sharing refresh while
  alternating waiters cancel independently before the refresh settles.
- `asyncExtensionCancellation`: initial token, external cache-store, retry
  policy and circuit failure-policy waits cancelled before their late async
  results can retain request state.
- `retryOnceClient`: requests that fail once and retry immediately.
- `httpErrorClient`: rejected requests without error hooks, retry hooks, or
  error interceptors.
- `loggerNoopClient`: request and response logging through a synchronous
  no-op logger.
- `loggerSensitiveQueryClient`: synchronous no-op logging for a URL containing
  a sensitive query value that must be redacted from lifecycle entries.
- `authNonRefreshErrorClient`: rejected authenticated requests that do not
  qualify for token refresh.
- `fetchAdapterClient`: complete FetchAdapter lifecycle against an in-memory
  Fetch response, without network latency.
- `fetchAdapterCompleteResponse`: the same Fetch lifecycle while preserving
  a separately readable raw `Response`.
- `fetchAdapterBoundedClient`: data-only Fetch parsing with a response-size
  limit enforced while the body is consumed.
- `fetchAdapterQueryClient`: data-only Fetch lifecycle with scalar, array,
  nullable and hash-aware query serialization.

Each result includes duration, operations per second, heap delta, mean latency
and p50/p95/p99/max latency. The report also includes client overhead relative
to the direct adapter and plugin throughput relative to the plain concurrent
client.

## Interpreting Results

Benchmark values depend on CPU, operating system, Node.js version and current
machine load. Compare reports produced on equivalent runners and look for
repeated trends rather than treating a single run as a release gate.

The default cache-key path normalizes configured vary-header names once and
reuses the resulting empty header metadata for headerless requests. The cache
miss path also reuses its registered deduplication key when handling the
response instead of serializing the same request identity twice. When
persistence is disabled, it only snapshots the response if a concurrent
follower needs it, and the shared completion Promise is created lazily when
that first follower arrives. The cache scenarios exercise these common paths
so repeated key, snapshot and coordination setup remain visible in
comparisons.

Logger lifecycle state reuses a redacted URL while the effective URL remains
unchanged, re-runs redaction if another plugin modifies it, and iterates query
keys without first copying them into an array. The two logger scenarios keep
both the inexpensive and sensitive-query paths visible.

Static authentication applies a configured token directly when no request-level
authentication override is present, and creates a single-field header
initializer when the request has no existing headers. The two authentication
scenarios keep the bare fast path and full header-merge path visible.
Concurrent refreshes remain single-flight while each waiter independently
observes cancellation across asynchronous refresh policy, token refresh and
post-refresh provider stages.

CI stores the JSON report as a build artifact. Correctness and resource
cleanup remain enforced separately by unit, integration and browser stress
tests.

Half-open circuit probes retain their configured concurrency slot while an
asynchronous `shouldCountFailure` policy is still classifying the result. Slow
or rejected policies therefore cannot admit an unbounded replacement stream;
unit state-machine tests cover counted, uncounted and rejected classifications.

## Hot-path Design

Interceptor and plugin-hook priority is recalculated only when registrations
change. Requests iterate cached ordered arrays, and clients without active
interceptors or hooks skip those async stages entirely. Synchronous
interceptors and plugin hooks remain on the synchronous lifecycle path until a
Promise requires continuation. This keeps plugin ordering deterministic without
allocating and sorting collections on every request. Error notification and
final rejection likewise stay synchronous until an asynchronous hook or
interceptor requires continuation. Lifecycle stages with one hook dispatch it
directly, avoiding an empty recursive continuation after asynchronous hooks.
Requests without any hooks, interceptors, or response schema dispatch directly
after validation without allocating lifecycle context, timestamps, or an
adopting Pipeline Promise. Method shortcuts merge their configuration once
before dispatch.

Configuration merging creates nested values only when either side supplies
them. Header normalization writes directly into one case-insensitive result
instead of building intermediate entry arrays and objects. Request-specific
headers remain isolated from reusable client defaults. Nested merge helpers
reuse their caller's presence checks, and single-sided headers skip the absent
input entirely. Body-mode detection checks only the four own configuration
fields, avoiding duplicate value and ownership probes on body-free requests.

Method shortcuts without client defaults or request options reuse an internal
empty configuration marker and construct only the final URL and method pair.
Explicit request options continue through the full isolation merge. Request
configuration and record serializers cache the native own-property intrinsic
instead of resolving its prototype chain for every field.

Request method and response-type validation use direct branch dispatch instead
of scanning constant option arrays. Valid request bodies likewise use direct
mode checks, reserving field collection for the conflicting-body error path.
Retry decisions skip elapsed-time and event bookkeeping when jitter,
elapsed-time limits and retry observers are all absent.
Requests using only plugin-level retry defaults also skip per-request WeakMap
retention; request-level overrides remain normalized once and reused across
subsequent attempts. In the 600,000-operation one-retry stress segment this
raised throughput from about 187,000 to 192,000 ops/s and reduced sampled p99
from 0.488 ms to 0.460 ms.

Cache entries retain isolation cloning for objects and binary values. Immutable
primitive data bypasses `structuredClone`, avoiding exception or clone overhead
without exposing mutable shared state.
Data-only cache requests do not retain a second raw response body that the
caller cannot observe. Complete-response calls and other raw-body hooks still
snapshot and clone raw responses independently, while ordinary cache hits keep
the same structured-clone isolation for mutable data.

Cache entries and in-flight deduplication are capability-aware: a rawless entry
or data-only leader cannot satisfy a later complete-response caller. That caller
uses a separate raw-capable leader shared with other complete-response callers,
and the less capable leader cannot subsequently overwrite the complete cached
response. A complete-response leader can still serve data-only followers
without an extra network operation.

Explicit cache clearing advances an in-memory generation before invoking the
store. This isolates new requests from old in-flight leaders and prevents stale
asynchronous reads, writes and cache-control deletions from affecting the new
generation, without abandoning callers already waiting on an older leader.

The Pipeline passes its final validated `Headers` directly to the first
adapter attempt. FetchAdapter reuses that instance for request construction;
direct adapter calls and retries still perform their own validation.

Successful data-only Fetch requests parse the original response without
cloning when no response hooks or interceptors need `raw`. Complete successful
responses and response lifecycle extensions retain a separately readable raw
body. HTTP errors parse the original body so ignored failures cannot retain an
unread stream branch; their parsed payload remains available as `error.data`.

Data-only XHR progress requests likewise avoid teeing a body solely to preserve
an unused raw branch. Buffered JSON, text, Blob and ArrayBuffer responses parse
directly from the Blob already produced by XHR instead of converting it through
a Response stream; Blob MIME types are normalized when necessary. Finite size
limits and streaming types retain the bounded general parser. Complete-response
calls, HTTP errors and response hooks that declare raw-body access retain a
readable raw response. Across the cumulative 100,000-operation XHR stress
segments, upload throughput rose from about 60,100 to 152,000 ops/s and download
throughput from about 52,700 to 160,900 ops/s. Upload retained heap fell from
about 224.3 MiB to 0.4 MiB; download p99 fell from 4.703 ms to 0.298 ms and its
segment peak RSS from about 1,461.5 MiB to 405.0 MiB.

Data-only responses with a size limit apply one bounded reader during parsing.
The adapter installs the earlier stream bound only when the raw response must
be preserved or cloned, avoiding duplicate stream wrappers on the common data
path.

Stateful isolation plugins resolve ordinary relative URLs without first
attempting an absolute `URL` parse. Absolute and base-relative requests retain
standards-based origin parsing without using expected exceptions as control
flow. Repeated isolation checks for the same exact URL and base URL reuse a
single bounded successful-origin entry.

The circuit breaker remembers its most recently accessed circuit and skips
redundant Map order rewrites for consecutive requests to the same isolation
key. Switching keys still refreshes LRU order before inactive-state eviction.

Immediately admitted concurrency requests reuse their isolation record as
lifecycle admission state. Retention order is refreshed when the record becomes
inactive, avoiding per-request admission objects and redundant Map writes while
active and queued records remain protected from eviction.

Request construction avoids success-path body-field arrays and iterates query,
form and FormData records without intermediate entry arrays. URL joining uses
relative-path fast paths while query encoding remains delegated to
`URLSearchParams`.
