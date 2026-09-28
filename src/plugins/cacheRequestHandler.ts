import { RequestError } from '../errors'
import type { RequestContext } from '../core/RequestContext'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import type { PluginContext } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { resolveRequestCachePolicy } from './cachePolicy'
import { isCacheableRequest } from './cacheLifecycle'
import { createCacheKey } from './cacheKey'
import {
  acquireCacheGeneration,
  isCurrentCacheGeneration,
  readStore
} from './cacheShared'
import {
  normalizeCacheTags,
  normalizeCacheTtl,
  normalizeStaleIfError,
  normalizeStaleWhileRevalidate
} from './cacheValidation'
import type { CachePluginOptions } from './cacheTypes'
import type { CacheState } from './cacheState'
import type { CacheInstallation } from './cacheInstallation'
import { createCacheMissHandler } from './cacheMissHandler'
import { createCacheRecordHandler } from './cacheRecordHandler'

export function createCacheRequestHandler(
  state: CacheState,
  installation: CacheInstallation,
  context: PluginContext,
  options: CachePluginOptions
) {
  const {
    store, automaticInvalidations, methods, recordEvent, noStoreRequests,
    forcedRevalidations, varyHeaders, emptyHeaderValues, keyMemo,
    keyGenerations, requestGenerations, keyOperations, tagInvalidations
  } = state
  const prepareCacheMiss = createCacheMissHandler(
    state, installation, options,
    (...args) => handleCacheRecord(...args)
  )
  const handleCacheRecord = createCacheRecordHandler(
    state, installation, context, prepareCacheMiss
  )

  return (requestContext: RequestContext<unknown>) => {
    const cache = resolveExtensionConfig(
      requestContext.config,
      'cache'
    )

    if (!cache) {
      return
    }

    const invalidationTags = normalizeCacheTags(
      cache.invalidateTags,
      requestContext.config
    )

    if (invalidationTags.length > 0) {
      if (!store.invalidateTags) {
        throw new RequestError(
          'Cache store does not support tag invalidation',
          {
            code: 'CONFIG_ERROR',
            config: requestContext.config
          }
        )
      }

      automaticInvalidations.set(requestContext, invalidationTags)
    }

    if (
      !cache.enabled ||
      !isCacheableRequest(requestContext.config, methods, cache)
    ) {
      return
    }

    normalizeCacheTtl(cache.ttl, requestContext.config)
    normalizeStaleIfError(
      cache.staleIfError,
      requestContext.config
    )
    normalizeStaleWhileRevalidate(
      cache.staleWhileRevalidate,
      requestContext.config
    )
    const tags = normalizeCacheTags(
      cache.tags,
      requestContext.config
    )

    const requestPolicy = resolveRequestCachePolicy(
      requestContext.config
    )

    if (requestPolicy === 'no-store') {
      recordEvent('bypass')
      noStoreRequests.add(requestContext)
      return
    }

    if (
      requestPolicy === 'revalidate' ||
      requestContext.background
    ) {
      forcedRevalidations.add(requestContext)
    }

    const key = createCacheKey(
      requestContext.config,
      cache,
      varyHeaders,
      emptyHeaderValues,
      keyMemo
    )
    const requestGeneration = acquireCacheGeneration(
      state.generation,
      key,
      keyGenerations,
      tags
    )

    requestGenerations.set(requestContext, requestGeneration)

    const read = () => {
      const stored = readStore(store, key)

      if (isPromiseLike(stored)) {
        const pending = requestContext.config.signal
          ? waitForSignal(() => stored, requestContext.config)
          : Promise.resolve(stored)

        return pending.then(record => {
          if (!isCurrentCacheGeneration(
            requestGeneration,
            state.generation,
            keyGenerations
          )) {
            return
          }

          return handleCacheRecord(
            requestContext,
            cache,
            key,
            record,
            requestGeneration
          )
        })
      }

      return handleCacheRecord(
        requestContext,
        cache,
        key,
        stored,
        requestGeneration
      )
    }
    const pendingInvalidations = new Set<Promise<void>>()
    const keyInvalidation = keyOperations.get(key)

    if (keyInvalidation) {
      pendingInvalidations.add(keyInvalidation)
    }

    for (const tag of tags) {
      const pending = tagInvalidations.get(tag)

      if (pending) {
        pendingInvalidations.add(pending)
      }
    }

    if (pendingInvalidations.size > 0) {
      const wait = Promise.all(pendingInvalidations).then(() => {})

      return requestContext.config.signal
        ? waitForSignal(() => wait, requestContext.config)
            .then(read)
        : wait.then(read)
    }

    return read()
  }
}
