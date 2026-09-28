import type { RequestContext } from '../core/RequestContext'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { isCacheableRequest, isAsyncIterable } from './cacheLifecycle'
import { createCacheKey } from './cacheKey'
import {
  isCurrentCacheGeneration,
  deleteStore,
  writeStore
} from './cacheShared'
import { createCacheEntry, createRevalidatedResponse } from './cacheResponse'
import {
  normalizeCacheTtl,
  normalizeStaleIfError,
  normalizeStaleWhileRevalidate
} from './cacheValidation'
import { resolveResponseCachePolicy } from './cachePolicy'
import type { CacheState } from './cacheState'

export function createCacheResponseHandler(state: CacheState) {
  const {
    cacheFallbacks,
    recordEvent,
    cacheHits,
    leaders,
    uncacheableLeaders,
    methods,
    noStoreRequests,
    revalidations,
    varyHeaders,
    emptyHeaderValues,
    keyMemo,
    unsharedGenerations,
    requestGenerations,
    keyGenerations,
    completedRecords,
    store
  } = state

  return (requestContext: RequestContext<unknown>) => {
    if (
      cacheFallbacks.has(requestContext) &&
      requestContext.fallbackResponse
    ) {
      recordEvent('stale-if-error')
      cacheHits.add(requestContext)
      requestContext.cacheHit = true

      if (leaders.get(requestContext)?.owner === requestContext) {
        uncacheableLeaders.add(requestContext)
      }
      return
    }

    if (cacheHits.has(requestContext)) {
      return
    }

    const cache = resolveExtensionConfig(
      requestContext.config,
      'cache'
    )

    if (
      !cache?.enabled ||
      !requestContext.response ||
      !isCacheableRequest(requestContext.config, methods, cache) ||
      noStoreRequests.has(requestContext)
    ) {
      return
    }

    const revalidation = revalidations.get(requestContext)

    if (
      requestContext.response.raw.type === 'opaque' ||
      requestContext.response.raw.type === 'opaqueredirect'
    ) {
      if (leaders.get(requestContext)?.owner === requestContext) {
        uncacheableLeaders.add(requestContext)
      }
      return
    }

    if (
      revalidation &&
      requestContext.response.status === 304
    ) {
      recordEvent('revalidated')
      requestContext.response = createRevalidatedResponse(
        revalidation,
        requestContext.response,
        requestContext.config
      )
    }

    const leader = leaders.get(requestContext)
    const key = leader?.key ?? createCacheKey(
      requestContext.config,
      cache,
      varyHeaders,
      emptyHeaderValues,
      keyMemo
    )
    const currentGeneration = isCurrentCacheGeneration(
      leader?.generation ??
        unsharedGenerations.get(requestContext) ??
        requestGenerations.get(requestContext),
      state.generation,
      keyGenerations
    )
    const generationTags = (
      leader?.generation ?? requestGenerations.get(requestContext)
    )?.token.tags
    const entryTags = generationTags && generationTags.size > 0
      ? [...generationTags]
      : revalidation?.tags

    if (isAsyncIterable(requestContext.response.data)) {
      uncacheableLeaders.add(requestContext)

      if (!currentGeneration) {
        return
      }

      const deletion = deleteStore(store, key)

      if (isPromiseLike(deletion)) {
        return requestContext.config.signal
          ? waitForSignal(() => deletion, requestContext.config)
          : deletion
      }
      return
    }

    const configuredTtl = normalizeCacheTtl(
      cache.ttl,
      requestContext.config
    )
    const configuredStaleIfError = normalizeStaleIfError(
      cache.staleIfError,
      requestContext.config
    )
    const configuredStaleWhileRevalidate =
      normalizeStaleWhileRevalidate(
        cache.staleWhileRevalidate,
        requestContext.config
      )
    const policy = resolveResponseCachePolicy(
      requestContext.response,
      configuredTtl,
      configuredStaleIfError,
      configuredStaleWhileRevalidate
    )
    const ttl = policy.ttl

    if (!policy.persist) {
      const deletion = currentGeneration
        ? deleteStore(store, key)
        : undefined
      const waitsForDeletion = isPromiseLike(deletion)
      const pending = leader

      if (
        pending?.owner === requestContext &&
        (pending.promise !== undefined || waitsForDeletion)
      ) {
        completedRecords.set(
          requestContext,
          createCacheEntry(
            requestContext.response,
            Date.now() + Math.max(0, ttl),
            requestContext.preserveRaw,
            entryTags
          )
        )
      } else if (pending?.owner === requestContext) {
        uncacheableLeaders.add(requestContext)
      }

      if (waitsForDeletion) {
        return requestContext.config.signal
          ? waitForSignal(
              () => deletion as PromiseLike<void>,
              requestContext.config
            )
          : deletion
      }
      return
    }

    const record = createCacheEntry(
      requestContext.response,
      Date.now() + ttl,
      requestContext.preserveRaw,
      entryTags
    )

    completedRecords.set(requestContext, record)

    if (!currentGeneration) {
      return
    }

    if (leader?.rawDemanded) {
      return
    }

    const write = writeStore(store, key, record)

    if (isPromiseLike(write)) {
      return requestContext.config.signal
        ? waitForSignal(() => write, requestContext.config)
        : write
    }
  }
}
