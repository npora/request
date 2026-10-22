# Performance Benchmarks

See the [runtime-hardening candidate report](measurements/runtime-hardening/README.md)
for the latest local stable-version HTTP comparison, size costs, adverse-body
diagnostics and verification results. It identifies unreleased changes separately
from the unchanged 1.20.2 npm release.

`pnpm benchmark:compare -- --large-json` repeats the same rotated-order HTTP
comparison for GET responses containing a 64 KiB string payload. It records the
actual JSON response byte size and verifies every returned value and server
request count. This complements the ordinary small-response comparison and the
single-run adverse-body diagnostics.

The core benchmark measures request-library overhead without network latency.
It uses a minimal stateless adapter, a warm-up phase and the same workload for
every scenario. A separate HTTP benchmark uses a localhost server. The core
adapter intentionally omits request history so test-only observability storage
is not mistaken for production request overhead during long stress runs.

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
  --warmup 500 \
  --samples 4096
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
  --samples 4096 \
  --output benchmark-results/http.json
```

The core and localhost HTTP runners retain at most `--samples` evenly spaced
latencies (4,096 by default), while throughput still covers every operation.
This keeps multi-million-request runs from allocating and sorting a latency
array for every request. Reports include the actual `latencySamples` count so
percentiles cannot be mistaken for full-population measurements.

The stress runner distributes an exact total across core dispatch,
serialization, interceptors, cache hits, deduplication and clear races, immediate and
contended concurrency, queued cancellation, closed and transitioning circuits,
one-retry requests, authentication, asynchronous extension cancellation,
logging, Standard Schema, expected errors,
pre-aborted signals, Fetch/XHR upload and download progress, SSE, NDJSON, and a
mixed plugin pipeline. Latencies are bounded samples rather than a ten-million
element allocation. With `--expose-gc`, retained heap is measured after each
scenario while peak RSS records transient runtime pressure.

On 2026-09-01, Node.js 24.18.0 on Darwin arm64 completed the final matrix with
256 workers in 36.17 seconds with zero unexpected failures. It included 200,000
OpenTelemetry CLIENT spans with W3C trace-context injection, 200,000 immediately
admitted rate-limited transport attempts, 1,200,000
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
| Bare core dispatch | 1,200,000 | 7,629,042 ops/s | 0.097 ms | 0 |
| Immediately admitted rate limit | 200,000 | 2,728,465 ops/s | 0.257 ms | 0 |
| Immediately admitted concurrency | 700,000 | 2,197,085 ops/s | 0.191 ms | 0 |
| OpenTelemetry span and propagation | 200,000 | 458,852 ops/s | 1.044 ms | 0 |
| Single-permit FIFO contention | 600,000 | 748,764 ops/s | 0.682 ms | 0 |
| Cache miss deduplication | 400,000 | 440,460 ops/s | 1.523 ms | 0 |
| Queue cancellation | 200,000 | 224,567 ops/s | 3.911 ms | 0 |

The full run's maximum sampled scenario RSS was 405.86 MiB and its largest
post-GC retained heap delta was 2.08 MiB. The latter came from the intentionally
retained 200,000-entry rolling rate window. These values include Node, Fetch/XHR
test doubles, payload objects, latency samples, and runtime allocator behavior.

The separate localhost run sent 100,000 actual HTTP requests through the
native Node Fetch transport with concurrency 256. The server received every
request; throughput was 11,665 requests/s, sampled p50 was 19.511 ms, p95 was
27.362 ms, and p99 was 29.462 ms. This loopback result includes sockets, HTTP
parsing, body streaming, and JSON parsing, but still does not predict remote
service latency or production proxy/TLS behavior.

## Scenarios

- `directAdapter`: adapter-only control measurement.
- `bareRequestApi`: direct `client.request(config)` dispatch with no client
  defaults, guarding the plain-config/native-Request detection path.
- `bareRequestResponseApi`: complete-response variant of the same direct API
  path.
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
- `cacheStaleWhileRevalidateClient`: repeated stale object reads while one
  background refresh remains pending, exposing response restoration work.
- `cacheMissClient`: repeated cacheable requests with persistence disabled,
  covering miss registration and response handling.
- `cacheDedupeClient`: concurrent cache misses sharing one leader response.
- `cacheClearRaces`: concurrent data-only and complete-response leader/follower
  pairs detached from the cache generation before their adapters settle.
- `concurrencyImmediateClient`: sequential requests admitted immediately by
  the concurrency plugin without queueing.
- `rateLimitImmediate`: transport attempts admitted immediately by the
  rolling-window rate limiter.
- `openTelemetryImmediate`: CLIENT span creation, stable HTTP attributes,
  sanitized URL processing, W3C-compatible header injection, response status,
  and deterministic span cleanup against an in-memory adapter.
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

Run the local HTTP benchmark to measure the native Fetch transport with a
temporary loopback server:

```sh
pnpm benchmark:http
```

Keep reports from the same runtime, workload, concurrency, and machine when
tracking changes. Record the Git revision and whether the working tree is clean
alongside each report. Loopback throughput measures local HTTP overhead;
remote latency, TLS, and proxies require application-specific measurements.
Use the internal same-process controls and regression budgets in CI to check
request overhead separately from network behavior.

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

The six request throughput gates use five paired rounds rather than one
ratio calculated from scenarios measured far apart. Each pair runs the
candidate and baseline next to each other, reverses their order on alternating
rounds, and gates on the median of the five raw ratios. This reduces sensitivity
to runner load and measurement order without lowering the existing thresholds.
The full scenario results remain in the report for trend analysis.

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
input entirely. Sanitized client defaults keep an internal own-field snapshot,
so hot request merges do not repeat ownership probes or read mutable prototype
state. The same snapshot records whether defaults contain a body mode, letting
body-free plugin requests skip four request-field ownership checks. In the
current 256-worker microbenchmarks, configured JSON serialization recovered
from about 548,000 to 844,000 ops/s, while cache hits rose from about 366,000
to 383,000 ops/s without weakening inherited-field isolation.

Plain request configs are rejected from native `Request` detection by prototype
before the branded native getter is attempted, avoiding an expected exception
on every direct API call. On Node.js 24.18.0, a focused 300,000-operation
sequential microbenchmark improved median `client.request(config)` throughput
from about 196,000 to 3,048,000 ops/s and `requestResponse(config)` from about
199,000 to 3,276,000 ops/s. Method-shortcut throughput remained within normal
run-to-run variation.

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

## Streaming schema and regression gates

Measure long SSE and NDJSON lines arriving in 64-byte chunks:

```sh
pnpm benchmark:streaming-lines -- --output benchmark-results/streaming-lines.json
```

The benchmark verifies exactly one intact record for 64, 128, and 256 KiB
payloads, then reports three timing samples and their median per format and
size. `--operations` changes the largest payload length and `--samples` changes
the number of rounds. Input is generated before timing; stream reads, decoding,
parsing, and result verification are timed. CI records the report alongside
the existing benchmarks. Timing is diagnostic rather than an absolute gate.

On a local Node.js 24.18.0 / macOS arm64 run, the median for a 256 KiB payload
arriving in 64-byte chunks changed as follows (three rounds per format):

| Format | Before | After |
| --- | ---: | ---: |
| NDJSON | 1,923.78 ms | 4.26 ms |
| SSE | 1,902.46 ms | 4.02 ms |

These are in-memory fragmented-line measurements, not network throughput or a
prediction for ordinary short records. Repeat them on the target runtime.

The parser scans each decoded chunk once and retains unfinished lines as
fragments until a delimiter or EOF. This avoids repeated prefix scanning and
flattening as a line grows across many small chunks. A complete JSON record or
SSE data line still needs memory proportional to its length; configure
`maxResponseSize` when the total stream needs a bound.

`pnpm benchmark:streaming` generates response bodies lazily under Web Stream
backpressure rather than allocating the complete payload. Its default run
validates one million NDJSON records and one million SSE events with Standard
Schema. Both formats cross chunk boundaries and yield 100 times to simulate a
slow consumer; separate probes assert that schema failures and early consumer
termination cancel the source reader.

On Node.js 24.18.0 (arm64), the 2026-09-01 reference run produced:

| Scenario | Records | Records/s | Chunks | Retained heap after GC |
| --- | ---: | ---: | ---: | ---: |
| NDJSON + itemSchema | 1,000,000 | 1,261,832 | 258 | 0.19 MiB |
| SSE + itemSchema | 1,000,000 | 801,289 | 562 | 0.04 MiB |

CI runs this exact two-million-item workload and checks
`benchmark/performance-budget.json`. Request-path limits are ratios against a
same-process baseline for GET, JSON, plugin pipeline, primitive cache hit,
rate-limit admission, and OpenTelemetry Metrics, avoiding hardware-specific
absolute thresholds. The
streaming gate additionally requires exact record counts, multi-chunk parsing,
ordered checksums, 100 slow-consumer yields, bounded pre/post-GC heap growth,
two validation-failure cancellations, two consumer cancellations, and
conservative throughput floors. The parser emits lines directly from decoded
chunks instead of allocating an intermediate array for every chunk.

## Pinned library comparison

Competitor measurements are optional and separate from CI's internal regression
budgets. The private fixture has its own npm lockfile; it adds no dependencies
to the published client or the root development dependency graph. Versions are
fixed comparison subjects, not a claim about the latest release.

```sh
pnpm build
npm ci --prefix benchmark/competitors --ignore-scripts --no-audit --no-fund
pnpm benchmark:compare -- \
  --operations 5000 --concurrency 64 --warmup 500 --rounds 6 \
  --samples 4096 --output benchmark-results/comparison.json
pnpm benchmark:compare:size -- --output package-size-results/comparison.json
```

Run timing benchmarks by themselves on an otherwise idle machine. The HTTP
runner requires permission to listen on a loopback port. It imports the built
`dist/core.js`, not TypeScript source. It compares native Fetch, Npora Request,
Axios's Node HTTP adapter, Axios's Fetch adapter, Ky, and ofetch. The Node HTTP
adapter is explicit and has proxy lookup disabled to avoid runner proxy settings;
this represents the usual Node transport, not Axios's browser transport.

GET JSON, POST JSON, and query JSON each run six rounds. Every client has the
same warmup and timed operation counts and concurrency. Client order rotates
one position per round, so each occupies each position once with the default
six clients and six rounds. Other round counts are allowed for smoke checks;
use multiples of six for balanced position coverage. No retry or cache plugin
is installed; Ky and ofetch retries are explicitly disabled. Ky's default timeout
is disabled too. All timed operations parse the same JSON response and assert
its value. Server checks validate POST JSON and query values. Exact request
counts are asserted for each client/run and for the complete measurement;
failures abort report generation rather than producing a successful result.

Reports retain every run, sample count, throughput, sampled p95/p99, heap delta,
round order, actual dependency versions, Git revision and dirty state, runtime
and CPU, and hashes of the build and both lockfiles. Summary values are medians
across rounds (the mean of the middle two values for even round counts).
Heap delta is the difference in process heap before and after a run, without
forced GC: it can be negative and is not retained memory, peak memory, or a
cross-client memory ranking. Clients share a process and some share native
Fetch pools; rotation reduces order bias but does not provide process isolation.

The browser size comparison uses esbuild's browser resolution, ESM, ES2020,
minification, tree shaking, and gzip level 9 for every entry. Each exports a
function fetching parsed JSON. The exact entry strings and bundler version
are recorded. Npora resolves to the same built core entry measured by the
regular consumer report. Different entry wrappers can change compressed sizes
by a few bytes. The native Fetch entry is wrapper code only; the browser's
implementation is not bundled. These are basic-use bundle costs, not equivalent
feature sets: validation, retry, cache, hooks, and streaming capabilities differ.

Loopback HTTP numbers include each client's default connection management and
transport, server processing, JSON parsing, and benchmark assertions. They do
not isolate wrapper overhead and do not predict TLS, remote latency, browsers,
large responses, retries, streaming, or production performance. Keep min/max
and raw rounds alongside medians; do not turn these results into an absolute
"fastest client" claim or an external-library CI gate.

### Versioned evidence

The [unreleased streaming-guards candidate](measurements/streaming-guards/README.md)
records the fixed implementation commit, before/after package and consumer
costs, all six HTTP rounds, adverse HTTP scenarios, serialized stress/streaming
checks, and the explicit budget tradeoff for the new guards. Its manifest still
says 1.19.6; it is distinct from the already published 1.19.6 build.

The [1.19.3 snapshot](measurements/1.19.3/README.md) records a clean-commit run,
all six HTTP rounds, request-count validation, consumer bundle contributions,
fixed dependency versions, and browser comparison entry strings. It also records
limitations and the next bundle-cost investigation. Keep versioned evidence
separate from ignored scratch reports under `benchmark-results`.

The [streaming parser split investigation](measurements/streaming-split/README.md)
includes an unapplied candidate patch and before/after single-bundle, initial,
and total split costs. It explains why parser-only dynamic loading was rejected.

## Bounded response reader benchmark

```sh
pnpm build
pnpm benchmark:response-stream -- --output benchmark-results/response-stream.json
```

This runner imports the built core entry and consumes 200,000 chunks of 256
bytes, with a 10,000-chunk warmup and five rounds per interface. Both the direct
data API and complete-response API use a 30-second timeout and a response limit
exactly equal to the expected byte count. It asserts every chunk and byte count,
normal completion without source cancellation, and reader-lock release. It uses
a zero-high-water-mark source and reuses one immutable byte array to isolate
reader-wrapper overhead. Concurrency is one; timings are diagnostic and do not
represent remote networking, payload allocation, JSON parsing, or large-chunk
throughput. Reports contain build/lockfile hashes and runtime/Git metadata.

The [shared response reader snapshot](measurements/shared-response-reader/README.md)
contains the before/after runs, bundle measurements, and validation results.

## Slow responses, large bodies, cancellation, and streaming

After installing the pinned comparison dependencies and building, run:

```sh
node --import tsx benchmark/competitors/edge-cases.mjs \
  --operations 1000 --concurrency 64 \
  --output benchmark-results/http-edge-cases.json
```

Each of the six clients uses the same loopback server. Scenarios cover a 5 ms
server delay, a 64 KiB JSON string, cancellation after the first streaming chunk,
byte-verified streaming with a 2 ms consumer pause, and 16 MiB binary streams
verified with SHA-256. Retries are disabled. The binary case transfers 16 MiB
per operation per client; start with `--operations 64 --concurrency 8 --warmup 8`
for diagnostic runs rather than a large default workload.
Axios HTTP streams use a Node-to-Web stream bridge. Cancellation must eventually
reject the active body; the runner does not assume all clients discard buffered
data identically. Server disconnect notifications are asynchronous, so their
per-client deltas can include earlier cancellations. Overall counts are retained.

This is one run per scenario/client with rotated client order across scenarios,
not a robust external-library performance ranking. The ordinary JSON comparison
uses repeated rounds. Neither measures remote services, TLS, production capacity,
peak/retained memory, or all browser transport behavior. Run performance suites
sequentially to reduce cross-test CPU/GC interference.

The streaming-guard change reserves 400 additional gzip bytes per consumer
scenario for idle-timeout, per-record size accounting, and buffered-record
cancellation checks. Distributed ESM/CommonJS declaration ceilings increase by
750 raw bytes and 250 gzip bytes for the three documented public options.
Tarball, unpacked-package, and executable-subpath ceilings stay unchanged.
Internal helper names may be minified; exported functions and constructor names
are checked in both module formats. Smaller npm artifacts do not imply a smaller
application bundle: the application bundler already minifies internal bindings.
