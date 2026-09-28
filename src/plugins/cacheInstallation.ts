import { RequestError } from '../errors'
import type { RequestContext } from '../core/RequestContext'
import { isPromiseLike } from '../utils/isPromiseLike'
import type { CacheRefreshLease } from './cacheStores'
import {
  abortBackgroundRefreshes,
  isEligibleStaleIfError,
  isSchemaValidationFailure
} from './cacheLifecycle'
import { restoreCacheEntry } from './cacheResponse'
import { releaseCacheGeneration } from './cacheShared'
import { ignoreCacheEventError } from './cacheEvents'
import type { CachePlugin } from './cacheTypes'
import type { CacheState } from './cacheState'

/** One installation owns only its leaders and refresh leases. */
export function createCacheInstallation() {
  return {
    active: true,
    ownedLeaders: new Set<object>(),
    ownedRefreshLeases: new Set<CacheRefreshLease>()
  }
}

export type CacheInstallation = ReturnType<typeof createCacheInstallation>

export function createCacheErrorHandler(state: CacheState) {
  const { staleFallbacks, cacheFallbacks } = state
  return (requestContext: RequestContext<unknown>) => {
    const record = staleFallbacks.get(requestContext)

    if (
      !record ||
      !isEligibleStaleIfError(requestContext.error)
    ) {
      return
    }

    const response = restoreCacheEntry(
      record,
      requestContext.config
    )

    if (response) {
      cacheFallbacks.add(requestContext)
      requestContext.fallbackResponse = response
    }
  }
}

export function createCacheSettledHandler(
  state: CacheState,
  installation: CacheInstallation,
  plugin: CachePlugin
) {
  const {
    refreshLeases, forcedRevalidations, noStoreRequests, staleFallbacks,
    cacheFallbacks, requestGenerations, automaticInvalidations, keyGenerations,
    leaders, revalidations, rawLeaders, rawInFlight, inFlight,
    uncacheableLeaders, completedRecords
  } = state
  const { ownedLeaders, ownedRefreshLeases } = installation

  return (requestContext: RequestContext<unknown>) => {
    const refreshLease = refreshLeases.get(requestContext)

    if (refreshLease) {
      refreshLease.release()
      ownedRefreshLeases.delete(refreshLease)
    }
    refreshLeases.delete(requestContext)
    forcedRevalidations.delete(requestContext)
    noStoreRequests.delete(requestContext)
    staleFallbacks.delete(requestContext)
    cacheFallbacks.delete(requestContext)

    const requestGeneration = requestGenerations.get(requestContext)
    const invalidateAfterSuccess = () => {
      const tags = automaticInvalidations.get(requestContext)

      automaticInvalidations.delete(requestContext)

      if (
        !tags ||
        requestContext.background ||
        requestContext.error ||
        !requestContext.response
      ) {
        return
      }

      try {
        const result = plugin.invalidateTags(tags)

        if (isPromiseLike(result)) {
          return Promise.resolve(result)
            .then(() => {})
            .catch(ignoreCacheEventError)
        }
      } catch {
        // A settled invalidation failure cannot replace a successful request.
      }
    }

    if (requestGeneration) {
      requestGenerations.delete(requestContext)
      releaseCacheGeneration(requestGeneration, keyGenerations)
    }

    const pending = leaders.get(requestContext)

    if (!pending) {
      return invalidateAfterSuccess()
    }

    leaders.delete(requestContext)
    ownedLeaders.delete(requestContext)
    revalidations.delete(requestContext)

    const key = pending.key

    const requests = rawLeaders.delete(requestContext)
      ? rawInFlight
      : inFlight

    if (requests.get(key) === pending) {
      requests.delete(key)
    }

    if (uncacheableLeaders.delete(requestContext)) {
      pending.resolve?.(undefined)
      return invalidateAfterSuccess()
    }

    const record = completedRecords.get(requestContext)

    completedRecords.delete(requestContext)

    if (
      record &&
      requestContext.response &&
      (
        !requestContext.error ||
        isSchemaValidationFailure(requestContext.error)
      )
    ) {
      pending.resolve?.(record)
      return invalidateAfterSuccess()
    }

    pending.reject?.(
      requestContext.error ??
      new RequestError('Shared request failed', {
        code: 'NETWORK_ERROR',
        config: requestContext.config
      })
    )

    return invalidateAfterSuccess()
  }
}

export function createCacheCleanup(
  state: CacheState,
  installation: CacheInstallation
) {
  const {
    leaders, rawLeaders, rawInFlight, inFlight, keyGenerations, backgroundRefreshes
  } = state
  const { ownedLeaders, ownedRefreshLeases } = installation

  return () => {
    installation.active = false

    for (const lease of ownedRefreshLeases) {
      lease.release()
    }

    ownedRefreshLeases.clear()

    for (const owner of ownedLeaders) {
      const pending = leaders.get(owner)

      leaders.delete(owner)

      if (!pending) {
        continue
      }

      const key = pending.key

      const requests = rawLeaders.delete(owner)
        ? rawInFlight
        : inFlight

      if (requests.get(key) === pending) {
        requests.delete(key)
      }
      pending.reject?.(
        new RequestError('Cache plugin removed during shared request', {
          code: 'ABORT_ERROR'
        })
      )
    }

    ownedLeaders.clear()
    keyGenerations.clear()
    abortBackgroundRefreshes(backgroundRefreshes)
  }
}
