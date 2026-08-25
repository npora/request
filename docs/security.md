# Security model

Npora Request is an HTTP client, not a security boundary for application data.
It provides defensive request handling while leaving endpoint trust,
authorization policy, response validation, and secret storage to the
application.

## Built-in protections

- Request configuration is validated before adapters perform network I/O.
- Clients can reject absolute request URLs that would bypass a configured
  `baseURL` by setting `allowAbsoluteUrls: false`; validation repeats after
  request interceptors and plugin hooks.
- Native `Headers` validation rejects invalid names, values, and CRLF header
  injection.
- Query, form, and FormData builders process own properties only.
- Configuration merging is tested against prototype-pollution inputs.
- Logger output omits headers, bodies, auth configuration, response bodies,
  causes, URL credentials, and sensitive query values.
- Default cache keys vary by authorization, cookie, accept, and language
  headers to prevent cross-session cache reuse.
- Responses marked `Cache-Control: no-store` or `Vary: *` are not persisted
  by the cache plugin.
- Cache freshness never exceeds the configured TTL or a valid response
  `max-age` after subtracting `Age`; expired and `no-cache` entries are reused
  only after successful `ETag` or `Last-Modified` validation. Ambiguous
  freshness is not persisted.
- Cache keys include all explicitly configured request headers so custom
  response `Vary` dimensions cannot reuse another header variant, except cache
  control fields which are excluded from keys and cause matching `Vary`
  responses to bypass persistence.
- Request `Cache-Control: no-store` bypasses cache reads, writes, and in-flight
  sharing; `no-cache`, `max-age=0`, and legacy `Pragma: no-cache` force a
  validator check or network refresh.
- Stale fallback is bounded by response `stale-if-error` and the optional
  application limit. It applies only after retries to network, timeout, and
  5xx failures; cancellation and local validation errors stay visible.
- Stale-while-revalidate is time bounded and launches at most one background
  refresh per cache key. Explicit validation and `must-revalidate` take
  precedence, and clear or plugin removal aborts active refreshes.
- Cache observation events expose only a decision type and timestamp. They
  never include URLs, cache keys, headers, bodies, or errors, and observer
  failures are isolated from request behavior.
- Targeted cache deletion uses the same key derivation as reads and writes.
  Callers must include the effective authorization and representation scope or
  use an appropriately scoped custom key when invalidating shared stores.
- Cache tags are limited to 32 values of at most 128 characters per entry.
  Custom stores must preserve tenant isolation when indexing tags and must not
  expose tag values through telemetry.
- Browser-persisted cache data remains readable to scripts running on the same
  origin. Use a dedicated `WebStorageCacheStore` namespace, clear it at account
  boundaries, prefer `sessionStorage`, and never persist secrets or responses
  that should not survive sign-out. Content security policy and XSS prevention
  remain application responsibilities.
- IndexedDB cache namespaces must follow the same account and schema-version
  boundaries. Structured cloning supports more sensitive binary and object
  types than JSON, so persistence eligibility must be decided before enabling
  `IndexedDBCacheStore`, not inferred from whether a value can be stored.
- Increment `IndexedDBCacheStore.schemaVersion` when a release changes the
  meaning or authorization assumptions of persisted values. A newer version
  isolates and prunes lower-version records without allowing an older
  version-aware tab to clear its newer cache. Schema versioning does not replace
  account-scoped namespaces or explicit cache clearing during sign-out.
- Bound persistent data with `IndexedDBCacheStore.maxBytes` when responses may
  contain large blobs or buffers. The estimate is deterministic but does not
  reveal the browser's exact origin quota. Quota recovery removes only scoped,
  compatible cache records and never treats eviction as permission to persist
  otherwise sensitive data.
- IndexedDB cache `onEvent` telemetry is aggregate-only. Do not correlate it
  with sensitive request data in application observers. Observer failures are
  isolated, and `getUsage()` never returns cache keys or values.
- Treat `IndexedDBCacheStore.shouldPersist` as part of the application's data
  classification boundary. It receives parsed data and response metadata but
  not the internal cache key or namespace. Returning `false` removes an older
  same-key value; callback errors preserve it and are surfaced to the caller.
- Choose `compact().expiredBefore` from the application's permitted stale
  retention window. The default current time removes all expired entries and
  can intentionally disable stale recovery for them. Bound large cleanup jobs
  with `maxRemovals`; reports and events contain aggregates rather than keys or
  values.
- Tiered cross-context invalidation broadcasts only control metadata and a
  non-cryptographic cache-key fingerprint, never the complete key, URL,
  headers, tags, or response data. Scope channel names by application and
  account. Same-origin scripts can still send eviction messages, which may
  reduce cache performance but cannot inject cached response data.
- Tiered refresh coordination exposes only the configured application
  namespace and a short non-cryptographic cache-key fingerprint to the
  same-origin Web Locks manager. It does not place complete cache keys, URLs,
  headers, or response bodies in lock names. Namespace locks by application,
  account, and cache schema version to avoid unintended contention.
- Automatic tag invalidation runs only after the final request pipeline
  succeeds. Failed authorization, validation, interception, cancellation, and
  exhausted retries do not evict previously valid data.
- Parsed and streamed responses can be bounded with `maxResponseSize`.
- Deterministically sized request bodies can be bounded with
  `maxRequestSize` before built-in transports dispatch them.
- Successful parsed responses can be validated and transformed with a
  Standard Schema v1 compatible validator before application response
  interceptors run.
- FormData array flattening rejects circular references and limits nesting to
  32 levels by default.
- Authentication refresh is deduplicated per client and token persistence is
  delegated to application-provided storage.
- Circuit-breaker isolation defaults to URL origins, excluding credentials,
  paths, queries, and request bodies from generated keys and rejection errors.
- Concurrency isolation also defaults to URL origins; queue-limit errors do not
  include the generated key.
- Default cache, circuit-breaker and concurrency state is capacity-bounded
  with LRU eviction; state serving active or queued requests is retained until
  those requests settle.
- Timeout, abort, XHR, hook, and plugin resources are cleaned up when a buffered
  request settles. Streaming resources remain active only until the response
  body completes, is cancelled, or errors.
- The published package has zero runtime dependencies and an exact tarball
  allowlist.

## Application responsibilities

Applications must still:

- Allowlist trusted origins when request URLs can be influenced by users.
- Treat server responses as untrusted and configure an appropriate response
  schema before use when runtime validation is required.
- Store credentials using controls appropriate to the runtime.
- Avoid placing secrets in URLs, thrown error messages, or application logs.
- Do not serialize a complete `RequestError` into logs or telemetry. Its public
  `config`, `response`, `data`, and `cause` fields intentionally preserve
  debugging context and may contain credentials or application data. Log an
  explicit allowlist of fields such as `name`, `message`, `code`, and `status`,
  or use `loggerPlugin`, which emits a safe summary.
- Configure CORS, TLS, cookies, redirects, and content security policy at the
  application and server layers.
- Review custom adapters, plugins, interceptors, schemas, cache keys, and
  `validateStatus` callbacks as application code.

The client intentionally does not block private network addresses or arbitrary
origins. Such a policy would break valid browser and server use cases; SSRF
controls belong at the application boundary.

## Verification

Security regressions run with:

```sh
pnpm test:security
pnpm audit:dependencies
pnpm audit:signatures
```

CI also performs CodeQL analysis, scheduled registry-install smoke tests,
coverage checks, package manifest verification, and Dependabot update checks.

See [SECURITY.md](../SECURITY.md) for private vulnerability reporting.
