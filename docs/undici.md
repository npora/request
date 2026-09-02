# Undici transport integration

Node.js applications can inject Undici's Fetch implementation to control
proxies, connection pools, mutual TLS, or DNS without replacing Npora
Request's adapter. Timeouts, retries, caching, validation, streaming, and
errors continue through the normal request lifecycle.

Install an Undici version compatible with the application's Node.js runtime,
then wrap a dispatcher as a Fetch-compatible function:

```ts
import {
  fetch as undiciFetch,
  type Dispatcher
} from 'undici'
import { createClient } from '@npora/request'

function fetchWith(
  dispatcher: Dispatcher
): typeof globalThis.fetch {
  return ((input, init) => undiciFetch(input, {
    ...init,
    dispatcher
  })) as typeof globalThis.fetch
}
```

`dispatcher` is an Undici extension rather than a standard `RequestInit`
field, so it belongs in the injected wrapper instead of `fetchOptions`.
[Undici Fetch documents custom dispatchers](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md),
and its dispatchers should be closed during application shutdown.

## HTTP and HTTPS proxies

```ts
import { ProxyAgent } from 'undici'

const proxy = new ProxyAgent({
  uri: process.env.HTTPS_PROXY!,
  token: `Bearer ${process.env.PROXY_TOKEN!}`
})

const api = createClient({ fetch: fetchWith(proxy) })

try {
  await api.get('https://service.example.com/health')
} finally {
  await proxy.close()
}
```

Use the agent's `token` or `auth` option for proxy credentials rather than a
request `proxy-authorization` header. `requestTls` configures TLS to the target;
`proxyTls` configures TLS to an HTTPS proxy. See the official
[ProxyAgent reference](https://github.com/nodejs/undici/blob/main/docs/docs/api/ProxyAgent.md).

## Connection pools

```ts
import { Agent } from 'undici'

const pool = new Agent({
  connections: 32,
  pipelining: 1,
  keepAliveTimeout: 10_000
})

const api = createClient({ fetch: fetchWith(pool) })

process.once('beforeExit', () => {
  void pool.close()
})
```

An `Agent` creates and reuses a pool per origin. Its `connections` limit is a
socket-pool setting; `concurrencyPlugin` limits active logical requests, while
`rateLimitPlugin` limits transport attempts over time. These controls solve
different problems and may be combined. See the official
[Agent reference](https://github.com/nodejs/undici/blob/main/docs/docs/api/Agent.md).

## Mutual TLS

```ts
import { readFile } from 'node:fs/promises'
import { Agent } from 'undici'

const [ca, cert, key] = await Promise.all([
  readFile('/run/secrets/service-ca.pem'),
  readFile('/run/secrets/client-cert.pem'),
  readFile('/run/secrets/client-key.pem')
])

const mtls = new Agent({
  connect: {
    ca,
    cert,
    key,
    rejectUnauthorized: true
  }
})

const api = createClient({ fetch: fetchWith(mtls) })
```

Keep private keys outside source control and retain certificate verification.
Undici's connector accepts Node TLS connection options; advanced certificate
pinning can wrap `buildConnector`. See the official
[Connector reference](https://github.com/nodejs/undici/blob/main/docs/docs/api/Connector.md).

## Custom DNS lookup

```ts
import { Agent } from 'undici'

const privateNetwork = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      serviceDiscovery.lookup(hostname, options, callback)
    }
  }
})

const api = createClient({
  fetch: fetchWith(privateNetwork)
})
```

The lookup callback must follow Node's DNS lookup contract and honor the
requested address family. Avoid returning untrusted private or link-local
addresses when request URLs are user-controlled; transport-level DNS routing
does not replace `allowAbsoluteUrls: false` or application SSRF controls.

Prefer one long-lived dispatcher per policy boundary instead of constructing
an agent per request. For process-wide policy, Undici also supports
`setGlobalDispatcher`, but per-client Fetch injection keeps proxy, certificate,
and DNS behavior isolated and explicit.
