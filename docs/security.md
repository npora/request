# Security model

Npora Request is an HTTP client, not a security boundary for application data.
It provides defensive request handling while leaving endpoint trust,
authorization policy, response validation, and secret storage to the
application.

## Built-in protections

- Request configuration is validated before adapters perform network I/O.
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
- Cache keys include all explicitly configured request headers so custom
  response `Vary` dimensions cannot reuse another header variant.
- Parsed and streamed responses can be bounded with `maxResponseSize`.
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
