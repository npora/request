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
- Authentication refresh is deduplicated per client and token persistence is
  delegated to application-provided storage.
- Circuit-breaker isolation defaults to URL origins, excluding credentials,
  paths, queries, and request bodies from generated keys and rejection errors.
- Timeout, abort, stream, XHR, hook, and plugin resources are cleaned up when a
  request settles.
- The published package has zero runtime dependencies and an exact tarball
  allowlist.

## Application responsibilities

Applications must still:

- Allowlist trusted origins when request URLs can be influenced by users.
- Treat server responses as untrusted and validate them before use.
- Store credentials using controls appropriate to the runtime.
- Avoid placing secrets in URLs, thrown error messages, or application logs.
- Configure CORS, TLS, cookies, redirects, and content security policy at the
  application and server layers.
- Review custom adapters, plugins, interceptors, cache keys, and
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
