import type { CacheOptions } from '../types'
import type { RequestContext } from '../core/RequestContext'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import type { PluginContext } from './Plugin'
import type { CacheEntry } from './cacheStores'
import type { CacheGeneration } from './cacheShared'
import { deleteStore, isCurrentCacheGeneration } from './cacheShared'
import { restoreCacheEntry } from './cacheResponse'
import {
  isExpired,
  normalizeStaleIfError,
  normalizeStaleWhileRevalidate
} from './cacheValidation'
import {
  canRevalidateCacheEntry,
  canUseStaleIfError,
  canUseStaleWhileRevalidate,
  startBackgroundRefresh
} from './cacheLifecycle'
import type { CacheState } from './cacheState'
import type { CacheInstallation } from './cacheInstallation'
import type { CacheMissHandler } from './cacheMissHandler'

export type CacheRecordHandler = (
  requestContext: RequestContext<unknown>,
  cache: CacheOptions,
  key: string,
  record: CacheEntry | undefined,
  requestGeneration: CacheGeneration
) => void | Promise<void>

export function createCacheRecordHandler(
  state: CacheState,
  installation: CacheInstallation,
  context: PluginContext,
  prepareCacheMiss: CacheMissHandler
): CacheRecordHandler {
  const {
    keyGenerations, forcedRevalidations, recordEvent, cacheHits,
    backgroundRefreshes, staleFallbacks, store
  } = state

  function handleCacheRecord(
    requestContext: RequestContext<unknown>,
    cache: CacheOptions,
    key: string,
    record: CacheEntry | undefined,
    requestGeneration: CacheGeneration
  ): void | Promise<void> {
    if (
      !installation.active ||
      !isCurrentCacheGeneration(
        requestGeneration,
        state.generation,
        keyGenerations
      )
    ) {
      return
    }

    if (record) {
      const fresh = !isExpired(record.expiresAt)
      const forceRevalidation = forcedRevalidations.has(requestContext)

      if (fresh && !forceRevalidation) {
        if (requestContext.preserveRaw && !record.raw) {
          return prepareCacheMiss(
            requestContext,
            cache,
            key,
            requestGeneration
          )
        }

        const cachedResponse = restoreCacheEntry(
          record,
          requestContext.config
        )

        if (cachedResponse) {
          recordEvent('hit')
          requestContext.response = cachedResponse
          cacheHits.add(requestContext)
          requestContext.cacheHit = true
          return
        }
      }

      if (
        !requestContext.background &&
        !forceRevalidation &&
        canUseStaleWhileRevalidate(
          record,
          requestContext.config,
          requestContext.preserveRaw,
          normalizeStaleWhileRevalidate(
            cache.staleWhileRevalidate,
            requestContext.config
          )
        )
      ) {
        const cachedResponse = restoreCacheEntry(
          record,
          requestContext.config
        )

        if (cachedResponse) {
          recordEvent('stale-while-revalidate')
          requestContext.response = cachedResponse
          cacheHits.add(requestContext)
          requestContext.cacheHit = true
          startBackgroundRefresh(
            context,
            backgroundRefreshes,
            key,
            requestContext.initialConfig,
            requestContext.preserveRaw,
            recordEvent
          )
          return
        }
      }

      if (
        !requestContext.background &&
        canUseStaleIfError(
          record,
          requestContext.config,
          requestContext.preserveRaw,
          normalizeStaleIfError(
            cache.staleIfError,
            requestContext.config
          )
        )
      ) {
        staleFallbacks.set(requestContext, record)
      }

      if (
        canRevalidateCacheEntry(
          record,
          requestContext.config,
          requestContext.preserveRaw
        ) &&
        restoreCacheEntry(record, requestContext.config)
      ) {
        return prepareCacheMiss(
          requestContext,
          cache,
          key,
          requestGeneration,
          record
        )
      }

      if ((fresh && forceRevalidation) || requestContext.background) {
        return prepareCacheMiss(
          requestContext,
          cache,
          key,
          requestGeneration
        )
      }

      const deletion = deleteStore(store, key)

      if (isPromiseLike(deletion)) {
        const deleted = requestContext.config.signal
          ? waitForSignal(() => deletion, requestContext.config)
          : Promise.resolve(deletion)

        return deleted.then(() => {
          return prepareCacheMiss(
            requestContext,
            cache,
            key,
            requestGeneration
          )
        })
      }
    }

    return prepareCacheMiss(
      requestContext,
      cache,
      key,
      requestGeneration
    )
  }

  return handleCacheRecord
}
