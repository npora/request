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
- `concurrentClient`: complete client pipeline with bounded concurrency.
- `concurrentPluginPipeline`: concurrent client with request/response
  interceptors and request/response plugin hooks.
- `cacheHitClient`: repeated data reads from the default in-memory cache.
- `concurrencyImmediateClient`: sequential requests admitted immediately by
  the concurrency plugin without queueing.
- `circuitBreakerSuccessClient`: successful requests tracked by a closed
  circuit breaker.
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

CI stores the JSON report as a build artifact. Correctness and resource
cleanup remain enforced separately by unit, integration and browser stress
tests.

## Hot-path Design

Interceptor and plugin-hook priority is recalculated only when registrations
change. Requests iterate cached ordered arrays, and clients without active
interceptors or hooks skip those async stages entirely. This keeps plugin
ordering deterministic without allocating and sorting collections on every
request.

Configuration merging creates nested values only when either side supplies
them. Header normalization writes directly into one case-insensitive result
instead of building intermediate entry arrays and objects. Request-specific
headers remain isolated from reusable client defaults.

The Pipeline passes its final validated `Headers` directly to the first
adapter attempt. FetchAdapter reuses that instance for request construction;
direct adapter calls and retries still perform their own validation.

Successful data-only Fetch requests parse the original response without
cloning when no response hooks or interceptors need `raw`. Complete responses,
response lifecycle extensions and HTTP errors retain a separately readable
raw body.

Request construction avoids success-path body-field arrays and iterates query,
form and FormData records without intermediate entry arrays. URL joining uses
relative-path fast paths while query encoding remains delegated to
`URLSearchParams`.
