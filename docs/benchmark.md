# Performance Benchmarks

The benchmark suite measures request-library overhead without network latency.
It uses a minimal stateless adapter, a warm-up phase and the same workload for
every scenario. The adapter intentionally omits request history so test-only
observability storage is not mistaken for production request overhead during
long stress runs.

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

## Scenarios

- `directAdapter`: adapter-only control measurement.
- `sequentialClient`: complete client pipeline, one request at a time.
- `bareSequentialClient`: method shortcut without client defaults or request
  options, measuring the minimum validated Client path.
- `jsonBodySequentialClient`: method shortcut replacing a default JSON body
  with a request JSON body.
- `sequentialPluginPipeline`: sequential client with synchronous request and
  response interceptors plus request and response plugin hooks.
- `concurrentClient`: complete client pipeline with bounded concurrency.
- `concurrentPluginPipeline`: concurrent client with request/response
  interceptors and request/response plugin hooks.
- `cacheHitClient`: repeated data reads from the default in-memory cache.
- `cachePrimitiveHitClient`: repeated immutable string reads from the default
  in-memory cache.
- `cacheMissClient`: repeated cacheable requests with persistence disabled,
  covering miss registration and response handling.
- `concurrencyImmediateClient`: sequential requests admitted immediately by
  the concurrency plugin without queueing.
- `circuitBreakerSuccessClient`: successful requests tracked by a closed
  circuit breaker.
- `concurrencyBaseClient`: immediately admitted concurrency-plugin requests
  resolved against an absolute base URL.
- `circuitBreakerBaseClient`: successful circuit-breaker requests resolved
  against an absolute base URL.
- `authStaticTokenClient`: requests authorized by the authentication plugin
  with a static token.
- `authBareTokenClient`: static-token authentication without pre-existing
  request headers.
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

CI stores the JSON report as a build artifact. Correctness and resource
cleanup remain enforced separately by unit, integration and browser stress
tests.

## Hot-path Design

Interceptor and plugin-hook priority is recalculated only when registrations
change. Requests iterate cached ordered arrays, and clients without active
interceptors or hooks skip those async stages entirely. Synchronous
interceptors and plugin hooks remain on the synchronous lifecycle path until a
Promise requires continuation. This keeps plugin ordering deterministic without
allocating and sorting collections on every request. Error notification and
final rejection likewise stay synchronous until an asynchronous hook or
interceptor requires continuation. Requests without any hooks, interceptors, or
response schema dispatch directly after validation without allocating lifecycle
context, timestamps, or an adopting Pipeline Promise. Method shortcuts merge
their configuration once before dispatch.

Configuration merging creates nested values only when either side supplies
them. Header normalization writes directly into one case-insensitive result
instead of building intermediate entry arrays and objects. Request-specific
headers remain isolated from reusable client defaults. Body-mode detection
checks only the four own configuration fields, avoiding duplicate value and
ownership probes on body-free requests.

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

Cache entries retain isolation cloning for objects and binary values. Immutable
primitive data bypasses `structuredClone`, avoiding exception or clone overhead
without exposing mutable shared state.

The Pipeline passes its final validated `Headers` directly to the first
adapter attempt. FetchAdapter reuses that instance for request construction;
direct adapter calls and retries still perform their own validation.

Successful data-only Fetch requests parse the original response without
cloning when no response hooks or interceptors need `raw`. Complete responses,
response lifecycle extensions and HTTP errors retain a separately readable
raw body.

Data-only responses with a size limit apply one bounded reader during parsing.
The adapter installs the earlier stream bound only when the raw response must
be preserved or cloned, avoiding duplicate stream wrappers on the common data
path.

Stateful isolation plugins resolve ordinary relative URLs without first
attempting an absolute `URL` parse. Absolute and base-relative requests retain
standards-based origin parsing without using expected exceptions as control
flow. Repeated isolation checks for the same exact URL and base URL reuse a
single bounded successful-origin entry.

Immediately admitted concurrency requests reuse their isolation record as
lifecycle admission state. Retention order is refreshed when the record becomes
inactive, avoiding per-request admission objects and redundant Map writes while
active and queued records remain protected from eviction.

Request construction avoids success-path body-field arrays and iterates query,
form and FormData records without intermediate entry arrays. URL joining uses
relative-path fast paths while query encoding remains delegated to
`URLSearchParams`.
