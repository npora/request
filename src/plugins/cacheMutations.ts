import { RequestError } from '../errors'
import type { RequestConfig } from '../types'
import { isPromiseLike } from '../utils/isPromiseLike'
import { abortBackgroundRefreshes } from './cacheLifecycle'
import { createCacheKey } from './cacheKey'
import { cloneCacheValue } from './cacheResponse'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import {
  normalizeCacheTtl,
  normalizeCacheStatus,
  normalizeCacheTags
} from './cacheValidation'
import { resetCacheStats } from './cacheEvents'
import type { CacheEntry, MaybePromise } from './cacheStores'
import type { CachePlugin } from './cacheTypes'
import { createCacheOperations } from './cacheOperations'
import type { CacheState } from './cacheState'

type CacheMutations = Pick<
  CachePlugin,
  'clear' | 'delete' | 'set' | 'update' | 'invalidateTags' | 'getStats' | 'resetStats'
>

export function createCacheMutations(state: CacheState): CacheMutations {
  const {
    store,
    keyGenerations,
    inFlight,
    rawInFlight,
    backgroundRefreshes,
    keyOperations,
    tagInvalidations,
    recordEvent,
    varyHeaders,
    emptyHeaderValues,
    keyMemo,
    stats
  } = state

  const {
    runKeyOperation, invalidateKeyState, trackTagInvalidation
  } = createCacheOperations(state)

  return {
    clear() {
      state.generation += 1
      inFlight.clear()
      rawInFlight.clear()
      keyGenerations.clear()
      abortBackgroundRefreshes(backgroundRefreshes)
      return store.clear()
    },

    delete(config) {
      const cache = resolveExtensionConfig(config, 'cache') ?? {}
      const key = createCacheKey(
        config,
        cache,
        varyHeaders,
        emptyHeaderValues,
        keyMemo
      )

      invalidateKeyState(key, 'Cache entry invalidated')

      return runKeyOperation(
        key,
        () => store.delete(key),
        [],
        'invalidated',
        'invalidation-error'
      )
    },

    set(config, data, setOptions = {}) {
      const cache = resolveExtensionConfig(config, 'cache') ?? {}
      const key = createCacheKey(
        config,
        cache,
        varyHeaders,
        emptyHeaderValues,
        keyMemo
      )
      const ttl = normalizeCacheTtl(
        setOptions.ttl ?? cache.ttl,
        config
      )
      const status = normalizeCacheStatus(setOptions.status, config)
      const tags = normalizeCacheTags(
        setOptions.tags ?? cache.tags,
        config
      )
      const entry: CacheEntry = {
        data: cloneCacheValue(data),
        expiresAt: ttl === Number.POSITIVE_INFINITY
          ? ttl
          : Date.now() + ttl,
        status,
        statusText: setOptions.statusText ?? (status === 200 ? 'OK' : ''),
        headers: [...new Headers(setOptions.headers).entries()],
        tags: tags.length > 0 ? tags : undefined
      }
      const waits = tags
        .map(tag => tagInvalidations.get(tag))
        .filter((pending): pending is Promise<void> => Boolean(pending))

      invalidateKeyState(key, 'Cache entry replaced')
      return runKeyOperation(key, () => store.set(key, entry), waits)
    },

    update<T>(
      config: RequestConfig,
      updater: (data: T) => T | undefined
    ) {
      const cache = resolveExtensionConfig(config, 'cache') ?? {}
      const key = createCacheKey(
        config,
        cache,
        varyHeaders,
        emptyHeaderValues,
        keyMemo
      )

      invalidateKeyState(key, 'Cache entry updated')

      return runKeyOperation(key, () => {
        const updateEntry = (entry: CacheEntry | undefined) => {
          if (!entry) {
            return false
          }

          const data = updater(cloneCacheValue(entry.data) as T)

          if (data === undefined) {
            const deletion = store.delete(key)

            return isPromiseLike(deletion)
              ? Promise.resolve(deletion).then(() => true)
              : true
          }

          const write = store.set(key, {
            ...entry,
            data: cloneCacheValue(data),
            raw: undefined
          })

          return isPromiseLike(write)
            ? Promise.resolve(write).then(() => true)
            : true
        }
        const entry = store.get(key)

        return isPromiseLike(entry)
          ? Promise.resolve(entry).then(updateEntry)
          : updateEntry(entry)
      }, tagInvalidations.values())
    },

    invalidateTags(input) {
      const tags = normalizeCacheTags(input)

      if (tags.length === 0) {
        throw new RequestError(
          'Cache tag invalidation requires at least one tag',
          { code: 'CONFIG_ERROR' }
        )
      }

      const invalidate = store.invalidateTags

      if (!invalidate) {
        throw new RequestError(
          'Cache store does not support tag invalidation',
          { code: 'CONFIG_ERROR' }
        )
      }

      for (const [key, token] of keyGenerations) {
        if (tags.some(tag => token.tags.has(tag))) {
          invalidateKeyState(key, 'Cache tags invalidated')
        }
      }

      const previous = new Set(
        tags
          .map(tag => tagInvalidations.get(tag))
          .filter((pending): pending is Promise<void> => Boolean(pending))
      )

      for (const pending of keyOperations.values()) {
        previous.add(pending)
      }

      if (previous.size > 0) {
        return trackTagInvalidation(
          tags,
          Promise.all(previous).then(() => invalidate.call(store, tags))
        )
      }

      let result: MaybePromise<number>

      try {
        result = invalidate.call(store, tags)
      } catch (error) {
        recordEvent('invalidation-error')
        throw error
      }

      if (!isPromiseLike(result)) {
        recordEvent('invalidated')
        return result
      }

      return trackTagInvalidation(tags, result)
    },

    getStats() {
      return { ...stats }
    },

    resetStats() {
      resetCacheStats(stats)
    },

  }
}
