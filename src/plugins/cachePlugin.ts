import type { CachePlugin, CachePluginOptions } from './cacheTypes'
import { createCacheState } from './cacheState'
import { createCacheMutations } from './cacheMutations'
import { createCacheResponseHandler } from './cacheResponseHandler'
import { createCacheRequestHandler } from './cacheRequestHandler'
import { cacheCredentialIdentity } from './cacheKey'
import {
  createCacheInstallation,
  createCacheErrorHandler,
  createCacheSettledHandler,
  createCacheCleanup
} from './cacheInstallation'

export type {
  CachePluginOptions,
  CachePlugin,
  CacheSetOptions,
  CacheEventType,
  CacheEvent,
  CacheStats
} from './cacheTypes'

export { MemoryCacheStore, WebStorageCacheStore } from './cacheStores'
export type {
  CacheEntry,
  CacheRefreshLease,
  CacheStore,
  MemoryCacheStoreOptions,
  WebStorageCacheStoreOptions
} from './cacheStores'

export {
  IndexedDBCacheStore
} from './indexedDBCacheStore'
export type {
  IndexedDBCacheCompactionOptions,
  IndexedDBCacheCompactionResult,
  IndexedDBCacheStoreEvent,
  IndexedDBCacheUsage,
  IndexedDBCacheStoreOptions
} from './indexedDBCacheStore'
export {
  TieredCacheStore
} from './tieredCacheStore'
export type {
  TieredCacheCoordinationOptions,
  TieredCacheBroadcastOptions,
  TieredCacheStoreOptions
} from './tieredCacheStore'

export function cachePlugin(
  options: CachePluginOptions = {}
): CachePlugin {
  const state = createCacheState(options)
  const plugin: CachePlugin = {
    name: 'cache',
    ...createCacheMutations(state),

    install(context) {
      const installation = createCacheInstallation()
      context.hooks.onRequest(
        createCacheRequestHandler(state, installation, context, options)
      )
      context.hooks.onResponse(
        createCacheResponseHandler(state),
        { requiresRawResponse: false }
      )
      context.hooks.onTransport(requestContext => {
        const restore = state.revalidationRestorers.get(requestContext)
        if (restore && state.requestIdentities.get(requestContext) !==
          cacheCredentialIdentity(requestContext.config)) {
          restore(requestContext.config)
          state.revalidationRestorers.delete(requestContext)
          state.revalidations.delete(requestContext)
        }
      }, { priority: Number.MAX_SAFE_INTEGER })
      context.hooks.onError(createCacheErrorHandler(state))
      context.hooks.onSettled(
        createCacheSettledHandler(state, installation, plugin)
      )
      return createCacheCleanup(state, installation)
    }
  }

  return plugin
}
