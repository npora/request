import type {
  CacheOptions,
  HttpMethod,
  RequestConfig
} from '../types'
import { RequestError } from '../errors'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import type { RequestContext } from '../core/RequestContext'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import {
  resolveRequestCachePolicy,
  resolveResponseCachePolicy
} from './cachePolicy'
import {
  abortBackgroundRefreshes,
  canRevalidateCacheEntry,
  canUseStaleIfError,
  canUseStaleWhileRevalidate,
  isAsyncIterable,
  isCacheableRequest,
  isEligibleStaleIfError,
  isSchemaValidationFailure,
  prepareConditionalRevalidation,
  startBackgroundRefresh
} from './cacheLifecycle'
import {
  MemoryCacheStore
} from './cacheStores'
import type {
  CacheEntry,
  CacheRefreshLease,
  CacheStore,
  MaybePromise
} from './cacheStores'
import {
  createCacheKey,
  normalizeCacheHeaders,
  normalizeVaryHeaders
} from './cacheKey'
import type { CacheKeyMemo } from './cacheKey'
import {
  acquireCacheGeneration,
  createInFlightRequest,
  deleteStore,
  getInFlightPromise,
  isCurrentCacheGeneration,
  readStore,
  releaseCacheGeneration,
  waitForSharedRecord,
  writeStore
} from './cacheShared'
import type {
  CacheGeneration,
  InFlightRequest,
  KeyGeneration
} from './cacheShared'
import {
  cloneCacheValue,
  createCacheEntry,
  createCachedResponse,
  createRevalidatedResponse,
  restoreCacheEntry
} from './cacheResponse'
import {
  isExpired,
  normalizeCacheStatus,
  normalizeCacheTags,
  normalizeCacheTtl,
  normalizeStaleIfError,
  normalizeStaleWhileRevalidate
} from './cacheValidation'

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

export interface CachePluginOptions {
  /**
   * HTTP methods that may be cached.
   *
   * @default GET and HEAD
   */
  methods?: readonly HttpMethod[]

  /**
   * Additional request headers included in the default cache key.
   * All explicitly configured request headers are included automatically.
   *
   * @default authorization, cookie, accept and accept-language
   */
  varyHeaders?: readonly string[]

  /**
   * Cache storage shared by this plugin instance.
   *
   * @default an isolated MemoryCacheStore
   */
  store?: CacheStore

  /**
   * Maximum entries retained by the default MemoryCacheStore.
   * Ignored when `store` is provided.
   *
   * @default 1000
   */
  maxEntries?: number

  /**
   * Share one network operation between concurrent equivalent requests.
   *
   * @default true
   */
  dedupe?: boolean

  /**
   * Observe cache decisions without receiving cache keys, URLs or headers.
   * Callback failures are isolated from requests.
   */
  onEvent?: (event: CacheEvent) => void | Promise<void>
}

export interface CachePlugin extends Plugin {
  clear(): MaybePromise<void>

  /** Delete the entry matching an effective request configuration. */
  delete(config: RequestConfig): MaybePromise<void>

  /** Store parsed response data for an effective request configuration. */
  set<T>(
    config: RequestConfig,
    data: T,
    options?: CacheSetOptions
  ): MaybePromise<void>

  /** Update or delete an existing parsed cache value. */
  update<T>(
    config: RequestConfig,
    updater: (data: T) => T | undefined
  ): MaybePromise<boolean>

  /** Delete entries carrying any of the supplied tags. */
  invalidateTags(tags: string | readonly string[]): MaybePromise<number>

  getStats(): Readonly<CacheStats>

  resetStats(): void
}

export interface CacheSetOptions {
  /** Freshness lifetime in milliseconds. */
  ttl?: number

  /** Cached HTTP status. @default 200 */
  status?: number

  /** Cached HTTP status text. @default OK */
  statusText?: string

  headers?: HeadersInit

  /** Tags assigned to the entry. */
  tags?: readonly string[]
}

export type CacheEventType =
  | 'hit'
  | 'miss'
  | 'bypass'
  | 'invalidated'
  | 'invalidation-error'
  | 'deduplicated'
  | 'revalidated'
  | 'stale-if-error'
  | 'stale-while-revalidate'
  | 'background-refresh'
  | 'background-refresh-success'
  | 'background-refresh-error'

export interface CacheEvent {
  type: CacheEventType
  timestamp: number
}

export interface CacheStats {
  hits: number
  misses: number
  bypasses: number
  invalidations: number
  invalidationErrors: number
  deduplicated: number
  revalidations: number
  staleIfError: number
  staleWhileRevalidate: number
  backgroundRefreshes: number
  backgroundRefreshSuccesses: number
  backgroundRefreshErrors: number
}

type RecordCacheEvent = (type: CacheEventType) => void

const DEFAULT_CACHE_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD'
]

const DEFAULT_VARY_HEADERS = [
  'authorization',
  'cookie',
  'accept',
  'accept-language'
] as const

const CACHE_STAT_KEYS: Record<CacheEventType, keyof CacheStats> = {
  hit: 'hits',
  miss: 'misses',
  bypass: 'bypasses',
  invalidated: 'invalidations',
  'invalidation-error': 'invalidationErrors',
  deduplicated: 'deduplicated',
  revalidated: 'revalidations',
  'stale-if-error': 'staleIfError',
  'stale-while-revalidate': 'staleWhileRevalidate',
  'background-refresh': 'backgroundRefreshes',
  'background-refresh-success': 'backgroundRefreshSuccesses',
  'background-refresh-error': 'backgroundRefreshErrors'
}

function createCacheStats(): CacheStats {
  return {
    hits: 0,
    misses: 0,
    bypasses: 0,
    invalidations: 0,
    invalidationErrors: 0,
    deduplicated: 0,
    revalidations: 0,
    staleIfError: 0,
    staleWhileRevalidate: 0,
    backgroundRefreshes: 0,
    backgroundRefreshSuccesses: 0,
    backgroundRefreshErrors: 0
  }
}

function resetCacheStats(stats: CacheStats): void {
  Object.assign(stats, createCacheStats())
}

function createCacheEventRecorder(
  stats: CacheStats,
  onEvent?: CachePluginOptions['onEvent']
): RecordCacheEvent {
  return type => {
    incrementCacheStat(stats, type)

    if (!onEvent) {
      return
    }

    try {
      const result = onEvent({
        type,
        timestamp: Date.now()
      })

      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(ignoreCacheEventError)
      }
    } catch {
      // Observers must not change request behavior.
    }
  }
}

function incrementCacheStat(
  stats: CacheStats,
  type: CacheEventType
): void {
  const key = CACHE_STAT_KEYS[type]

  stats[key] = Math.min(
    Number.MAX_SAFE_INTEGER,
    stats[key] + 1
  )
}

function ignoreCacheEventError(): void {
  // Async observers are isolated from request handling.
}

export function cachePlugin(
  options: CachePluginOptions = {}
): CachePlugin {
  const store: CacheStore = options.store ?? new MemoryCacheStore({
    maxEntries: options.maxEntries
  })
  const cacheHits = new WeakSet<object>()
  const leaders = new WeakMap<object, InFlightRequest>()
  const requestGenerations = new WeakMap<object, CacheGeneration>()
  const automaticInvalidations = new WeakMap<object, readonly string[]>()
  const unsharedGenerations = new WeakMap<object, CacheGeneration>()
  const completedRecords = new WeakMap<object, CacheEntry>()
  const revalidations = new WeakMap<object, CacheEntry>()
  const forcedRevalidations = new WeakSet<object>()
  const noStoreRequests = new WeakSet<object>()
  const staleFallbacks = new WeakMap<object, CacheEntry>()
  const refreshLeases = new WeakMap<object, CacheRefreshLease>()
  const cacheFallbacks = new WeakSet<object>()
  const uncacheableLeaders = new WeakSet<object>()
  const inFlight = new Map<string, InFlightRequest>()
  const rawInFlight = new Map<string, InFlightRequest>()
  const rawLeaders = new WeakSet<object>()
  const backgroundRefreshes = new Map<string, AbortController>()
  const keyGenerations = new Map<string, KeyGeneration>()
  const keyOperations = new Map<string, Promise<void>>()
  const tagInvalidations = new Map<string, Promise<void>>()
  const stats = createCacheStats()
  const recordEvent = createCacheEventRecorder(stats, options.onEvent)
  let generation = 0
  const methods = new Set(
    options.methods ?? DEFAULT_CACHE_METHODS
  )
  const varyHeaders = normalizeVaryHeaders(
    options.varyHeaders ?? DEFAULT_VARY_HEADERS
  )
  const emptyHeaderValues = normalizeCacheHeaders(
    undefined,
    varyHeaders
  )
  const keyMemo: CacheKeyMemo = {}

  function trackKeyOperation<T>(
    key: string,
    result: PromiseLike<T>,
    success?: CacheEventType,
    failure?: CacheEventType
  ): Promise<T> {
    const operation = Promise.resolve(result)
    let pending!: Promise<void>

    pending = operation.then(
      () => success && recordEvent(success),
      () => failure && recordEvent(failure)
    ).finally(() => {
      if (keyOperations.get(key) === pending) {
        keyOperations.delete(key)
      }
    })

    keyOperations.set(key, pending)
    return operation
  }

  function runKeyOperation<T>(
    key: string,
    operation: () => MaybePromise<T>,
    waits: Iterable<Promise<void>> = [],
    success?: CacheEventType,
    failure?: CacheEventType
  ): MaybePromise<T> {
    const pending = new Set(waits)
    const previous = keyOperations.get(key)

    if (previous) {
      pending.add(previous)
    }

    if (pending.size > 0) {
      return trackKeyOperation(
        key,
        Promise.all(pending).then(operation),
        success,
        failure
      )
    }

    let result: MaybePromise<T>

    try {
      result = operation()
    } catch (error) {
      if (failure) {
        recordEvent(failure)
      }

      throw error
    }

    if (isPromiseLike(result)) {
      return trackKeyOperation(key, result, success, failure)
    }

    if (success) {
      recordEvent(success)
    }

    return result
  }

  function invalidateKeyState(key: string, reason: string): void {
    keyGenerations.delete(key)
    inFlight.delete(key)
    rawInFlight.delete(key)

    const refresh = backgroundRefreshes.get(key)

    if (refresh) {
      backgroundRefreshes.delete(key)
      refresh.abort(reason)
    }
  }

  function trackTagInvalidation(
    tags: readonly string[],
    invalidation: PromiseLike<number>
  ): Promise<number> {
    const operation = Promise.resolve(invalidation)
    let pending!: Promise<void>

    pending = operation.then(
      () => recordEvent('invalidated'),
      () => recordEvent('invalidation-error')
    ).finally(() => {
      for (const tag of tags) {
        if (tagInvalidations.get(tag) === pending) {
          tagInvalidations.delete(tag)
        }
      }
    })

    for (const tag of tags) {
      tagInvalidations.set(tag, pending)
    }

    return operation
  }

  const plugin: CachePlugin = {
    name: 'cache',

    clear() {
      generation += 1
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

    install(context) {
      const ownedLeaders = new Set<object>()
      const ownedRefreshLeases = new Set<CacheRefreshLease>()
      let active = true

      context.hooks.onRequest(requestContext => {
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
          generation,
          key,
          keyGenerations,
          tags
        )

        requestGenerations.set(requestContext, requestGeneration)

        const read = () => {
          const stored = readStore(store, key)

          if (
            requestContext.config.signal &&
            isPromiseLike(stored)
          ) {
            return waitForSignal(() => stored, requestContext.config)
              .then(record => {
              if (!isCurrentCacheGeneration(
                requestGeneration,
                generation,
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

          if (isPromiseLike(stored)) {
            return Promise.resolve(stored).then(record => {
              if (!isCurrentCacheGeneration(
                requestGeneration,
                generation,
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
      })

      context.hooks.onResponse(requestContext => {
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
          generation,
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
      }, { requiresRawResponse: false })

      function handleCacheRecord(
        requestContext: RequestContext<unknown>,
        cache: CacheOptions,
        key: string,
        record: CacheEntry | undefined,
        requestGeneration: CacheGeneration
      ): void | Promise<void> {
        if (
          !active ||
          !isCurrentCacheGeneration(
            requestGeneration,
            generation,
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

          if (fresh && forceRevalidation) {
            return prepareCacheMiss(
              requestContext,
              cache,
              key,
              requestGeneration
            )
          }

          if (requestContext.background) {
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

      function prepareCacheMiss(
        requestContext: RequestContext<unknown>,
        cache: CacheOptions,
        key: string,
        requestGeneration: CacheGeneration,
        staleRecord?: CacheEntry
      ): void | Promise<void> {
        if (
          !active ||
          !isCurrentCacheGeneration(
            requestGeneration,
            generation,
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

      context.hooks.onError(requestContext => {
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
      })

      context.hooks.onSettled(requestContext => {
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
      })

      return () => {
        active = false

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
  }

  return plugin
}
