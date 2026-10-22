# Cache workflows

Install `cachePlugin()` and enable `extensions.cache.enabled` per request or
in client defaults before using these workflows. For option defaults and
cache eligibility, see the [configuration reference](configuration.md#extensionscache).
For the smaller TTL-only alternative, see [memory caching](configuration.md#extensionsmemorycache).

## Shared requests and statistics

Equivalent concurrent cache-enabled requests share one network operation by
default. Pass a custom `CacheStore` to share cached entries across clients or
connect an external storage system:

```ts
const cache = cachePlugin({
  store: sharedStore,
  dedupe: true,
  onEvent(event) {
    metrics.increment(`cache.${event.type}`)
  }
})
```

Use `cache.getStats()` for a snapshot of hits, misses, bypasses,
invalidations, deduplication, revalidation, stale recovery, and background
refresh outcomes.
`cache.resetStats()` resets only these counters; it does not clear entries.
Events contain only a decision type and timestamp, never URLs, cache keys, or
headers. Observer failures do not affect requests.
Failed manual or automatic invalidations are counted in
`invalidationErrors` and emit `invalidation-error` without exposing the error.

## Update and invalidate entries

Seed or optimistically update parsed cache data without a network request:

```ts
await cache.set({ url: '/users/1' }, user, {
  ttl: 30000,
  tags: ['user:1']
})

await cache.update<User>({ url: '/users/1' }, current => ({
  ...current,
  name: 'Updated locally'
}))
```

Return `undefined` from `update` to delete the entry. It returns `false` when
no entry exists. These operations use the same effective cache key as requests,
wait for overlapping asynchronous store operations, and prevent older
same-key responses from overwriting the new value.

Delete one entry without flushing unrelated cached responses:

```ts
await cache.delete({
  url: '/users/1',
  baseURL: '/api',
  extensions: {
    cache: { enabled: true }
  }
})
```

Pass the effective request configuration used to create the entry, including
merged `baseURL`, query, response type, and representation headers. A custom
`extensions.cache.key` can be deleted without reproducing those dimensions.

Group related entries with bounded cache tags and invalidate them together:

```ts
await request.get('/users/1', {
  extensions: {
    cache: {
      enabled: true,
      tags: ['user:1', 'users']
    }
  }
})

await cache.invalidateTags('user:1')
```

The default memory store supports tags directly. Custom stores must implement
the optional `CacheStore.invalidateTags()` capability.

## Browser storage

Persist JSON-compatible cached data across client instances with isolated
browser storage:

```ts
import { WebStorageCacheStore } from '@npora/request/plugins/cache'

const cache = cachePlugin({
  store: new WebStorageCacheStore(sessionStorage, {
    namespace: 'dashboard-v1',
    maxEntries: 250
  })
})
```

Use `localStorage` only when responses may safely survive browser restarts and
sign-out boundaries. The adapter never persists native `Response` objects;
`getResponse()` refetches when raw bytes are required.

## IndexedDB

For larger values and non-blocking storage, use IndexedDB instead:

```ts
import { IndexedDBCacheStore } from '@npora/request/plugins/cache'

const store = new IndexedDBCacheStore(indexedDB, {
  databaseName: 'dashboard-cache',
  namespace: 'account:1',
  schemaVersion: 2,
  maxEntries: 500,
  maxBytes: 20 * 1024 * 1024,
  shouldPersist: (entry, bytes) => (
    entry.status === 200 && bytes < 2 * 1024 * 1024
  ),
  onEvent: event => metrics.record('persistent-cache', event)
})
const cache = cachePlugin({ store })
```

IndexedDB uses structured cloning, preserving values such as `Blob`, `Date`,
`Map`, typed arrays, and `BigInt` while still omitting native `Response` bodies.
Increment the positive integer `schemaVersion` whenever the cached data shape
becomes incompatible. Older records are isolated and pruned automatically;
the default version `1` continues to read records created before this option
existed. Older clients preserve every higher-version record without validating
its envelope, including during writes, clearing, compaction, and quota
recovery, so rolling deployments remain safe when the persisted structure
changes completely.
`maxBytes` adds an approximate structured-clone byte budget alongside
`maxEntries`. Oversized entries are skipped and older entries are evicted by
LRU. Quota-exceeded writes remove the oldest half of the current schema cache
and retry once by default; set `quotaRecovery: false` to report the first quota
failure without recovery.
Use `await store.getUsage()` to inspect the current schema's aggregate entry
count and estimated bytes. The optional `onEvent` observer reports aggregated
eviction, recovery, cleanup, and oversized-entry rejection events without
exposing keys, namespaces, URLs, or response data. Observer failures never
affect cache operations.
Use `shouldPersist(entry, estimatedBytes)` for application-specific admission,
such as excluding sensitive payloads, one-hit responses, or large low-value
objects. It may return a boolean or promise. Returning `false` removes an older
same-key value and emits an aggregate `admission-policy` rejection; thrown
errors are reported to the caller and leave the old value unchanged.
Run bounded maintenance without loading the namespace into memory:

```ts
const result = await store.compact({
  // Preserve seven days for stale-if-error recovery.
  expiredBefore: Date.now() - 7 * 24 * 60 * 60 * 1000,
  maxRemovals: 500
})
```

`compact()` removes current-schema entries beyond the chosen stale boundary,
reports aggregate scan/removal/byte counts, and emits privacy-safe `expired`
events. Repeat while `hasMore` is true when using `maxRemovals`. Usage
inspection now streams records through an IndexedDB cursor, avoiding a
namespace-sized result array.

## Tiered storage and cross-tab coordination

Combine memory speed with persistence through a read-through, write-through
store:

```ts
const persistent = new IndexedDBCacheStore(indexedDB, {
  namespace: 'account:1',
  schemaVersion: 2
})
const channel = new BroadcastChannel('dashboard-cache:account:1:v1')
const store = new TieredCacheStore({
  primary: new MemoryCacheStore({ maxEntries: 100 }),
  secondary: persistent,
  broadcast: { channel },
  coordination: {
    locks: navigator.locks,
    namespace: 'dashboard-cache:account:1:v1'
  }
})
const cache = cachePlugin({
  store
})
```

Hot reads remain synchronous. Cold secondary hits are promoted to memory, and
writes reach the persistent tier before becoming visible in memory. The
optional channel evicts stale primary entries in other tabs without sending
URLs, headers, response data, or complete cache keys. Call `store.dispose()`
and `channel.close()` when the context is torn down. Optional Web Locks
coordination serializes same-key refreshes across tabs; waiters reread the
shared secondary cache instead of issuing a duplicate request. Omit
`coordination` where `navigator.locks` is unavailable.

## Invalidate after mutations

Mutation requests can invalidate tags automatically after their final success:

```ts
await request.patch('/users/1', {
  json: update,
  extensions: {
    cache: {
      invalidateTags: ['user:1', 'users']
    }
  }
})
```

Final HTTP, Schema, interceptor, cancellation, and exhausted-retry failures do
not invalidate entries.

## HTTP freshness and stale recovery

The default memory store keeps up to 1,000 entries using LRU eviction. Expired
entries with `ETag` or `Last-Modified` validators are conditionally revalidated;
set `maxEntries` to tune the bound, use `0` to disable storage, or use `Infinity`
for an explicitly unbounded store.

Request `Cache-Control: no-cache` or `max-age=0` to force validation, and use
`Cache-Control: no-store` to bypass cache reads, writes, and request sharing.
Response `stale-if-error` can serve an expired entry after network, timeout, or
5xx failure; `extensions.cache.staleIfError` sets an application limit in
milliseconds.
Response `stale-while-revalidate` can return stale data immediately while one
deduplicated refresh runs through the same client pipeline in the background.

See the [API reference](api.md#cache) for store and mutation contracts.
