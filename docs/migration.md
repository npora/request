# Migrating from 0.x to 1.x

Version 1.0 freezes the package-root API and removes compatibility surfaces
that were deprecated during 0.x.

## Runtime requirement

Node.js 22 or newer is required. Browser builds require standards-compatible
Fetch, `Headers`, `Response`, and `AbortController` implementations.

## Namespaced plugin configuration

Move plugin-owned request options under `extensions`.

Before:

```ts
await request.get('/users', {
  retry: {
    retries: 2
  },
  cache: {
    enabled: true
  }
})
```

After:

```ts
await request.get('/users', {
  extensions: {
    retry: {
      retries: 2
    },
    cache: {
      enabled: true
    }
  }
})
```

The same rule applies to `auth`, `logger`, `upload`, and `download`.

## Cache invalidation

The global `clearCache()` export was removed. Each cache plugin owns an isolated
store, so retain the plugin instance and clear it directly.

Before:

```ts
import {
  cachePlugin,
  clearCache
} from '@npora/request'

request.use(cachePlugin())
clearCache()
```

After:

```ts
import { cachePlugin } from '@npora/request'

const cache = cachePlugin()

request.use(cache)
cache.clear()
```

## Fetch adapter on Node.js

Supported Node.js releases use their standards-compatible native Fetch
implementation through `FetchAdapter`. A separate Node-only adapter is not
required for normal HTTP requests.

Use a custom adapter only when a transport needs capabilities outside Fetch,
such as specialized proxy, dispatcher, connection, or protocol control.

## Complete responses

Data-first methods return the parsed body:

```ts
const user = await request.get<User>('/users/1')
```

Use `requestResponse()` or an HTTP `*Response()` method for response metadata:

```ts
const response = await request.getResponse<User>('/users/1')
```

## Recommended migration process

1. Upgrade the application runtime to Node.js 22 or newer.
2. Enable strict TypeScript checking.
3. Move all plugin request configuration under `extensions`.
4. Replace global cache invalidation with instance-level `clear()`.
5. Run integration tests around retries, authentication refresh, and custom
   adapters.
6. Review error handling against the stable `RequestError` codes.
