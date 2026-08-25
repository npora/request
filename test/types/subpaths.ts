import type {
  Client,
  RequestConfig,
  RequestError
} from '@npora/request/core'
import { createClient } from '@npora/request/core'
import type {
  CacheEvent,
  CachePluginOptions,
  CacheRefreshLease,
  CacheStats,
  IndexedDBCacheCompactionResult,
  IndexedDBCacheStoreEvent,
  IndexedDBCacheUsage,
  TieredCacheBroadcastOptions,
  TieredCacheCoordinationOptions
} from '@npora/request/plugins/cache'
import {
  cachePlugin,
  IndexedDBCacheStore,
  MemoryCacheStore,
  TieredCacheStore,
  WebStorageCacheStore
} from '@npora/request/plugins/cache'
import { retryPlugin } from '@npora/request/plugins/retry'
import type { MockAdapterOptions } from '@npora/request/testing'
import { MockAdapter } from '@npora/request/testing'

const adapterOptions: MockAdapterOptions = { delay: 1 }
const cacheOptions: CachePluginOptions = { maxEntries: 100 }
const cacheEvent: CacheEvent = { type: 'hit', timestamp: Date.now() }
const cacheStats: CacheStats = cachePlugin().getStats()
const deletion: void | Promise<void> = cachePlugin().delete({
  url: '/cached'
})
const tagDeletion: number | Promise<number> =
  cachePlugin().invalidateTags('cached')
const persistentStore = new WebStorageCacheStore(localStorage, {
  namespace: 'subpath-test'
})
const asynchronousPersistentStore = new IndexedDBCacheStore(indexedDB, {
  namespace: 'subpath-test',
  maxBytes: 1024 * 1024,
  onEvent(event: IndexedDBCacheStoreEvent) {
    void event.reason
  },
  shouldPersist: async (entry, estimatedBytes) => (
    entry.status === 200 && estimatedBytes < 512 * 1024
  ),
  schemaVersion: 2
})
const persistentUsage: Promise<IndexedDBCacheUsage> =
  asynchronousPersistentStore.getUsage()
const persistentCompaction: Promise<IndexedDBCacheCompactionResult> =
  asynchronousPersistentStore.compact({ maxRemovals: 100 })
const tieredStore = new TieredCacheStore({
  primary: new MemoryCacheStore(),
  secondary: asynchronousPersistentStore
})
const broadcastOptions: TieredCacheBroadcastOptions = {
  channel: new BroadcastChannel('subpath-test')
}
const coordinationOptions: TieredCacheCoordinationOptions = {
  locks: navigator.locks,
  namespace: 'subpath-test'
}
const refreshLease: Promise<CacheRefreshLease> =
  new TieredCacheStore({
    primary: new MemoryCacheStore(),
    secondary: asynchronousPersistentStore,
    coordination: coordinationOptions
  }).acquireRefreshLease!('subpath-test')

void cacheEvent
void cacheStats
void deletion
void tagDeletion
void persistentStore
void asynchronousPersistentStore
void persistentUsage
void persistentCompaction
void tieredStore
void broadcastOptions
void coordinationOptions
void refreshLease
const adapter = new MockAdapter(adapterOptions)
const client: Client = createClient({ adapter })
  .use(cachePlugin(cacheOptions))
  .use(retryPlugin({ retries: 1 }))
const config: RequestConfig = { url: '/typed-subpath' }

void client.request(config)

type CoreError = RequestError

void (undefined as unknown as CoreError)
