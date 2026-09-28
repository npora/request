import type { CacheOptions } from '../types'
import type { RequestContext } from '../core/RequestContext'
import { waitForSignal } from '../utils/waitForSignal'
import type { CacheEntry, CacheRefreshLease } from './cacheStores'
import type { CacheGeneration } from './cacheShared'
import {
  createInFlightRequest,
  getInFlightPromise,
  isCurrentCacheGeneration,
  readStore,
  waitForSharedRecord
} from './cacheShared'
import { createCachedResponse } from './cacheResponse'
import { prepareConditionalRevalidation } from './cacheLifecycle'
import type { CachePluginOptions } from './cacheTypes'
import type { CacheState } from './cacheState'
import type { CacheInstallation } from './cacheInstallation'
import type { CacheRecordHandler } from './cacheRecordHandler'

export type CacheMissHandler = (
  requestContext: RequestContext<unknown>,
  cache: CacheOptions,
  key: string,
  requestGeneration: CacheGeneration,
  staleRecord?: CacheEntry
) => void | Promise<void>

export function createCacheMissHandler(
  state: CacheState,
  installation: CacheInstallation,
  options: CachePluginOptions,
  handleCacheRecord: CacheRecordHandler
): CacheMissHandler {
  const {
    keyGenerations, recordEvent, unsharedGenerations, rawInFlight, inFlight,
    cacheHits, store, refreshLeases, forcedRevalidations, rawLeaders,
    leaders, revalidations
  } = state
  const { ownedLeaders, ownedRefreshLeases } = installation

  function prepareCacheMiss(
    requestContext: RequestContext<unknown>,
    cache: CacheOptions,
    key: string,
    requestGeneration: CacheGeneration,
    staleRecord?: CacheEntry
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

    if (!(cache.dedupe ?? options.dedupe ?? true)) {
      if (!requestContext.background) {
        recordEvent('miss')
      }
      unsharedGenerations.set(requestContext, requestGeneration)
      return
    }

    const pending = requestContext.preserveRaw
      ? rawInFlight.get(key)
      : inFlight.get(key) ?? rawInFlight.get(key)

    if (pending) {
      recordEvent('deduplicated')
      return waitForSharedRecord(
        getInFlightPromise(pending),
        requestContext.config
      ).then(sharedRecord => {
        if (!sharedRecord) {
          return
        }

        requestContext.response = createCachedResponse(
          sharedRecord,
          requestContext.config
        )
        cacheHits.add(requestContext)
        requestContext.cacheHit = true
      })
    }

    const acquireRefreshLease = store.acquireRefreshLease

    if (
      acquireRefreshLease &&
      !refreshLeases.has(requestContext)
    ) {
      let acquisition: Promise<CacheRefreshLease>

      try {
        const requested = acquireRefreshLease.call(
          store,
          key,
          requestContext.config.signal
        )
        acquisition = requestContext.config.signal
          ? waitForSignal(
              () => requested,
              requestContext.config
            )
          : requested
      } catch {
        const fallbackLease: CacheRefreshLease = {
          contended: false,
          release() {}
        }
        refreshLeases.set(requestContext, fallbackLease)
        return handleCacheRecord(
          requestContext,
          cache,
          key,
          staleRecord,
          requestGeneration
        )
      }

      return acquisition.then(lease => {
        refreshLeases.set(requestContext, lease)
        ownedRefreshLeases.add(lease)

        if (lease.contended) {
          forcedRevalidations.delete(requestContext)
          recordEvent('deduplicated')
        }

        return Promise.resolve(readStore(store, key)).then(record => {
          return handleCacheRecord(
            requestContext,
            cache,
            key,
            record,
            requestGeneration
          )
        })
      }, error => {
        if (requestContext.config.signal?.aborted) {
          throw error
        }

        const fallbackLease: CacheRefreshLease = {
          contended: false,
          release() {}
        }
        refreshLeases.set(requestContext, fallbackLease)
        return handleCacheRecord(
          requestContext,
          cache,
          key,
          staleRecord,
          requestGeneration
        )
      })
    }

    if (requestContext.preserveRaw) {
      const dataPending = inFlight.get(key)

      if (dataPending) {
        dataPending.rawDemanded = true
      }
    }

    const created = createInFlightRequest(
      requestContext,
      key,
      requestGeneration
    )

    if (requestContext.preserveRaw) {
      rawInFlight.set(key, created)
      rawLeaders.add(requestContext)
    } else {
      inFlight.set(key, created)
    }
    leaders.set(requestContext, created)
    ownedLeaders.add(requestContext)

    if (!requestContext.background) {
      recordEvent('miss')
    }

    if (
      staleRecord &&
      prepareConditionalRevalidation(
        requestContext.config,
        staleRecord
      )
    ) {
      revalidations.set(requestContext, staleRecord)
    }
  }

  return prepareCacheMiss
}
