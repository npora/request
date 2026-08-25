import type {
  CacheOptions,
  HttpMethod,
  NporaResponse,
  QueryParams,
  RequestConfig
} from '../types'
import { RequestError } from '../errors'
import { isURLSearchParams } from '../utils/isURLSearchParams'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import type { Plugin, PluginContext } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

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

type MaybePromise<T> = T | Promise<T>

export interface CacheEntry {
  data: unknown

  expiresAt: number

  status: number

  statusText: string

  headers: Array<[string, string]>

  tags?: readonly string[]

  raw?: Response
}

export interface CacheStore {
  get(key: string): MaybePromise<CacheEntry | undefined>

  set(key: string, entry: CacheEntry): MaybePromise<void>

  delete(key: string): MaybePromise<void>

  /** Optional capability required by cache.invalidateTags(). */
  invalidateTags?(tags: readonly string[]): MaybePromise<number>

  /** Optional cross-context lease used to coalesce cache refreshes. */
  acquireRefreshLease?(
    key: string,
    signal?: AbortSignal
  ): Promise<CacheRefreshLease>

  clear(): MaybePromise<void>
}

export interface CacheRefreshLease {
  /** Whether this lease waited for another context to release the key. */
  readonly contended: boolean

  /** Release the lease. Calling this more than once has no effect. */
  release(): void
}

export interface MemoryCacheStoreOptions {
  /**
   * Maximum entries retained by the in-memory LRU store.
   * Use `Infinity` for no practical limit.
   *
   * @default 1000
   */
  maxEntries?: number
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>()

  private readonly maxEntries: number

  private newestKey: string | undefined

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxEntries = normalizeMaxEntries(options.maxEntries)
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key)

    if (!entry) {
      return undefined
    }

    if (this.newestKey !== key) {
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.newestKey = key
    }

    return entry
  }

  set(key: string, entry: CacheEntry): void {
    if (this.maxEntries === 0) {
      return
    }

    this.entries.delete(key)

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value

      if (oldestKey === undefined) {
        break
      }

      this.entries.delete(oldestKey)
    }

    this.entries.set(key, entry)
    this.newestKey = key
  }

  delete(key: string): void {
    this.entries.delete(key)

    if (this.newestKey === key) {
      this.newestKey = undefined
    }
  }

  invalidateTags(tags: readonly string[]): number {
    const expected = new Set(tags)
    let deleted = 0

    for (const [key, entry] of this.entries) {
      if (entry.tags?.some(tag => expected.has(tag))) {
        this.entries.delete(key)
        deleted += 1

        if (this.newestKey === key) {
          this.newestKey = undefined
        }
      }
    }

    return deleted
  }

  clear(): void {
    this.entries.clear()
    this.newestKey = undefined
  }
}

export interface WebStorageCacheStoreOptions {
  /** Isolates this cache from other applications using the same storage. */
  namespace?: string

  /** Maximum persisted entries retained with LRU eviction. @default 1000 */
  maxEntries?: number
}

/** A namespaced persistent cache for localStorage or sessionStorage. */
export class WebStorageCacheStore implements CacheStore {
  private readonly prefix: string

  private readonly maxEntries: number

  constructor(
    private readonly storage: Storage,
    options: WebStorageCacheStoreOptions = {}
  ) {
    this.prefix = createWebStoragePrefix(options.namespace)
    this.maxEntries = normalizeMaxEntries(options.maxEntries)
  }

  get(key: string): CacheEntry | undefined {
    if (this.maxEntries === 0) {
      return undefined
    }

    const storageKey = this.prefix + key
    const record = this.read(storageKey)

    if (!record) {
      return undefined
    }

    try {
      this.storage.setItem(
        storageKey,
        serializeWebStorageEntry(record.entry, Date.now())
      )
    } catch {
      // LRU metadata is best effort; a readable entry remains usable.
    }

    return record.entry
  }

  set(key: string, entry: CacheEntry): void {
    if (this.maxEntries === 0) {
      return
    }

    const storageKey = this.prefix + key
    const keys = this.keys()
    const existing = keys.includes(storageKey)
    const removeCount = Math.max(
      0,
      keys.length - this.maxEntries + (existing ? 0 : 1)
    )

    if (removeCount > 0) {
      const oldest = keys
        .map(candidate => ({
          key: candidate,
          accessedAt: this.read(candidate)?.accessedAt ?? 0
        }))
        .filter(record => record.key !== storageKey)
        .sort((first, second) => first.accessedAt - second.accessedAt)

      for (const record of oldest.slice(0, removeCount)) {
        this.storage.removeItem(record.key)
      }
    }

    this.storage.setItem(
      storageKey,
      serializeWebStorageEntry(entry, Date.now())
    )
  }

  delete(key: string): void {
    this.storage.removeItem(this.prefix + key)
  }

  invalidateTags(tags: readonly string[]): number {
    const expected = new Set(tags)
    let deleted = 0

    for (const key of this.keys()) {
      const record = this.read(key)

      if (record?.entry.tags?.some(tag => expected.has(tag))) {
        this.storage.removeItem(key)
        deleted += 1
      }
    }

    return deleted
  }

  clear(): void {
    for (const key of this.keys()) {
      this.storage.removeItem(key)
    }
  }

  private keys(): string[] {
    const keys: string[] = []

    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index)

      if (key?.startsWith(this.prefix)) {
        keys.push(key)
      }
    }

    return keys
  }

  private read(key: string): WebStorageRecord | undefined {
    const value = this.storage.getItem(key)

    if (value === null) {
      return undefined
    }

    try {
      return parseWebStorageEntry(value)
    } catch {
      this.storage.removeItem(key)
      return undefined
    }
  }
}

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

const EMPTY_QUERY: ReadonlyArray<[string, string]> = []
const MAX_CACHE_TAGS = 32
const MAX_CACHE_TAG_LENGTH = 128

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
  const key: keyof CacheStats = type === 'hit'
    ? 'hits'
    : type === 'miss'
      ? 'misses'
      : type === 'bypass'
        ? 'bypasses'
        : type === 'invalidated'
          ? 'invalidations'
          : type === 'invalidation-error'
            ? 'invalidationErrors'
            : type === 'deduplicated'
            ? 'deduplicated'
            : type === 'revalidated'
              ? 'revalidations'
              : type === 'stale-if-error'
                ? 'staleIfError'
                : type === 'stale-while-revalidate'
                  ? 'staleWhileRevalidate'
                  : type === 'background-refresh'
                    ? 'backgroundRefreshes'
                    : type === 'background-refresh-success'
                      ? 'backgroundRefreshSuccesses'
                      : 'backgroundRefreshErrors'

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
          !isCacheableRequest(requestContext.config, methods)
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
          !isCacheableRequest(requestContext.config, methods) ||
          noStoreRequests.has(requestContext)
        ) {
          return
        }

        const revalidation = revalidations.get(requestContext)

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
        requestContext: {
          config: RequestConfig
          response?: NporaResponse
          readonly preserveRaw: boolean
          readonly background: boolean
          readonly initialConfig: RequestConfig
        },
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
            )
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
        requestContext: {
          config: RequestConfig
          response?: NporaResponse
          readonly preserveRaw: boolean
          readonly background: boolean
          readonly initialConfig: RequestConfig
        },
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

interface KeyGeneration {
  activeRequests: number
  tags: Set<string>
}

interface CacheGeneration {
  global: number
  key: string
  token: KeyGeneration
}

function acquireCacheGeneration(
  global: number,
  key: string,
  generations: Map<string, KeyGeneration>,
  tags: readonly string[]
): CacheGeneration {
  let token = generations.get(key)

  if (!token) {
    token = {
      activeRequests: 0,
      tags: new Set()
    }
    generations.set(key, token)
  }

  token.activeRequests += 1

  for (const tag of tags) {
    token.tags.add(tag)
  }

  return { global, key, token }
}

function isCurrentCacheGeneration(
  generation: CacheGeneration | undefined,
  global: number,
  generations: Map<string, KeyGeneration>
): boolean {
  return generation !== undefined &&
    generation.global === global &&
    generations.get(generation.key) === generation.token
}

function releaseCacheGeneration(
  generation: CacheGeneration,
  generations: Map<string, KeyGeneration>
): void {
  generation.token.activeRequests -= 1

  if (
    generation.token.activeRequests === 0 &&
    generations.get(generation.key) === generation.token
  ) {
    generations.delete(generation.key)
  }
}

interface InFlightRequest {
  owner: {
    readonly preserveRaw: boolean
  }

  key: string

  generation: CacheGeneration

  rawDemanded?: true

  promise?: Promise<CacheEntry | undefined>

  resolve?: (entry: CacheEntry | undefined) => void

  reject?: (error: unknown) => void
}

function createInFlightRequest(
  owner: InFlightRequest['owner'],
  key: string,
  generation: CacheGeneration
): InFlightRequest {
  return {
    owner,
    key,
    generation
  }
}

function getInFlightPromise(
  request: InFlightRequest
): Promise<CacheEntry | undefined> {
  if (request.promise) {
    return request.promise
  }

  let resolve!: (entry: CacheEntry | undefined) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<CacheEntry | undefined>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    }
  )

  void promise.catch(() => {})

  request.promise = promise
  request.resolve = resolve
  request.reject = reject

  return promise
}

function readStore(
  store: CacheStore,
  key: string
): MaybePromise<CacheEntry | undefined> {
  try {
    const result = store.get(key)

    return isPromiseLike(result)
      ? Promise.resolve(result).catch(() => undefined)
      : result
  } catch {
    return undefined
  }
}

function writeStore(
  store: CacheStore,
  key: string,
  entry: CacheEntry
): MaybePromise<void> {
  try {
    const result = store.set(key, entry)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).catch(ignoreStoreError)
    }
  } catch {
    // Cache storage failures must not change the network response.
  }
}

function deleteStore(
  store: CacheStore,
  key: string
): MaybePromise<void> {
  try {
    const result = store.delete(key)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).catch(ignoreStoreError)
    }
  } catch {
    // Expired or disabled cache entries can be ignored safely.
  }
}

function ignoreStoreError(): void {
  // Cache storage failures must not change the request lifecycle.
}

function waitForSharedRecord(
  promise: Promise<CacheEntry | undefined>,
  config: RequestConfig
): Promise<CacheEntry | undefined> {
  const signal = config.signal

  if (!signal) {
    return promise.catch(error => {
      throw cloneSharedError(error, config)
    })
  }

  if (signal.aborted) {
    return Promise.reject(
      createSharedAbortError(signal.reason, config)
    )
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup failures must not retain a shared-response wait.
      }
    }
    const resolveOnce = (entry: CacheEntry | undefined) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(entry)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      rejectOnce(createSharedAbortError(signal.reason, config))
    }

    try {
      signal.addEventListener('abort', onAbort, {
        once: true
      })
    } catch (error) {
      rejectOnce(error)
      return
    }

    if (signal.aborted) {
      onAbort()
    }

    if (settled) {
      return
    }

    promise.then(
      resolveOnce,
      error => {
        rejectOnce(cloneSharedError(error, config))
      }
    )
  })
}

function createSharedAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  return new RequestError('Request aborted while waiting for shared response', {
    code: 'ABORT_ERROR',
    config,
    cause: reason
  })
}

function cloneSharedError(
  error: unknown,
  config: RequestConfig
): unknown {
  if (!(error instanceof RequestError)) {
    return error
  }

  return new RequestError(error.message, {
    code: error.code,
    status: error.status,
    data: error.data,
    response: error.response,
    config,
    cause: error
  })
}

function createCacheEntry(
  response: NporaResponse,
  expiresAt: number,
  preserveRaw: boolean,
  tags?: readonly string[]
): CacheEntry {
  return {
    data: cloneCacheValue(response.data),
    expiresAt,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    tags: tags ? [...tags] : undefined,
    raw: preserveRaw
      ? cloneResponse(response.raw)
      : undefined
  }
}

function createCachedResponse(
  record: CacheEntry,
  config: RequestConfig
): NporaResponse {
  return {
    data: cloneCacheValue(record.data),
    status: record.status,
    statusText: record.statusText,
    headers: new Headers(record.headers),
    config,
    raw: cloneRawResponse(record)
  }
}

function restoreCacheEntry(
  record: CacheEntry,
  config: RequestConfig
): NporaResponse | undefined {
  try {
    return createCachedResponse(record, config)
  } catch {
    return undefined
  }
}

function isCacheableRequest(
  config: RequestConfig,
  methods: ReadonlySet<HttpMethod>
): boolean {
  return (
    methods.has(config.method ?? 'GET') &&
    config.responseType !== 'stream' &&
    config.responseType !== 'sse' &&
    config.responseType !== 'ndjson'
  )
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
}

function isSchemaValidationFailure(error: unknown): boolean {
  return error instanceof RequestError && error.code === 'SCHEMA_ERROR'
}

interface ResponseCachePolicy {
  persist: boolean
  ttl: number
}

type RequestCachePolicy = 'default' | 'revalidate' | 'no-store'

function resolveRequestCachePolicy(
  config: RequestConfig
): RequestCachePolicy {
  const headers = new Headers(config.headers)
  const cacheControl = headers.get('cache-control')
  let revalidate = false

  if (cacheControl) {
    for (const value of cacheControl.split(',')) {
      const directive = value.trim()
      const separator = directive.indexOf('=')
      const name = (
        separator === -1
          ? directive
          : directive.slice(0, separator)
      ).trim().toLowerCase()

      if (name === 'no-store') {
        return 'no-store'
      }

      if (name === 'no-cache') {
        revalidate = true
        continue
      }

      if (name === 'max-age' && separator !== -1) {
        const candidate = directive.slice(separator + 1).trim()
        const match = /^(?:"(\d+)"|(\d+))$/.exec(candidate)

        if (match && Number(match[1] ?? match[2]) === 0) {
          revalidate = true
        }
      }
    }
  } else if (
    headers
      .get('pragma')
      ?.split(',')
      .some(value => value.trim().toLowerCase() === 'no-cache')
  ) {
    revalidate = true
  }

  return revalidate ? 'revalidate' : 'default'
}

function resolveResponseCachePolicy(
  response: NporaResponse,
  configuredTtl: number,
  configuredStaleIfError?: number,
  configuredStaleWhileRevalidate?: number
): ResponseCachePolicy {
  const cacheControl = response.headers.get('cache-control')
  let maxAgeSeconds: number | undefined
  let requiresRevalidation = false

  if (cacheControl) {
    for (const value of cacheControl.split(',')) {
      const directive = value.trim()
      const separator = directive.indexOf('=')
      const name = (
        separator === -1
          ? directive
          : directive.slice(0, separator)
      ).trim().toLowerCase()

      if (name === 'no-store') {
        return NO_CACHE_POLICY
      }

      if (name === 'no-cache') {
        requiresRevalidation = true
        continue
      }

      if (name !== 'max-age') {
        continue
      }

      if (maxAgeSeconds !== undefined) {
        return NO_CACHE_POLICY
      }

      const candidate = directive.slice(separator + 1).trim()
      const match = /^(?:"(\d+)"|(\d+))$/.exec(candidate)

      if (!match) {
        return NO_CACHE_POLICY
      }

      maxAgeSeconds = Number(match[1] ?? match[2])
    }
  }

  if (
    response.headers
      .get('vary')
      ?.split(',')
      .some(name => {
        const normalized = name.trim().toLowerCase()

        return normalized === '*' ||
          isRequestCacheControlHeader(normalized)
      })
  ) {
    return NO_CACHE_POLICY
  }

  if (configuredTtl <= 0) {
    return NO_CACHE_POLICY
  }

  if (
    maxAgeSeconds !== undefined &&
    !Number.isSafeInteger(maxAgeSeconds)
  ) {
    return NO_CACHE_POLICY
  }

  const ttl = requiresRevalidation
    ? 0
    : maxAgeSeconds === undefined
      ? configuredTtl
      : Math.min(
          configuredTtl,
          Math.max(
            0,
            (maxAgeSeconds - parseAge(response.headers.get('age'))) * 1000
          )
        )

  return {
    ttl,
    persist: ttl > 0 ||
      hasResponseValidator(response.headers) ||
      resolveStaleIfErrorWindow(
        response.headers,
        configuredStaleIfError
      ) > 0 ||
      (
        !requiresRevalidation &&
        resolveStaleWhileRevalidateWindow(
          response.headers,
          configuredStaleWhileRevalidate
        ) > 0
      )
  }
}

const NO_CACHE_POLICY: ResponseCachePolicy = {
  persist: false,
  ttl: 0
}

function parseAge(value: string | null): number {
  if (!value || !/^\d+$/.test(value.trim())) {
    return 0
  }

  const age = Number(value)

  return Number.isSafeInteger(age) ? age : 0
}

function canUseStaleIfError(
  record: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean,
  configuredStaleIfError?: number
): boolean {
  try {
    if (preserveRaw && !record.raw) {
      return false
    }

    const headers = new Headers(config.headers)

    if (
      headers.has('if-none-match') ||
      headers.has('if-modified-since') ||
      headers.has('range')
    ) {
      return false
    }

    const window = resolveStaleIfErrorWindow(
      new Headers(record.headers),
      configuredStaleIfError
    )

    return window > 0 &&
      Number.isFinite(record.expiresAt) &&
      Date.now() < record.expiresAt + window &&
      restoreCacheEntry(record, config) !== undefined
  } catch {
    return false
  }
}

function canUseStaleWhileRevalidate(
  record: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean,
  configured?: number
): boolean {
  try {
    if (preserveRaw && !record.raw) {
      return false
    }

    const requestHeaders = new Headers(config.headers)
    const responseHeaders = new Headers(record.headers)

    if (
      requestHeaders.has('if-none-match') ||
      requestHeaders.has('if-modified-since') ||
      requestHeaders.has('range') ||
      hasCacheControlDirective(responseHeaders, 'no-cache') ||
      hasCacheControlDirective(responseHeaders, 'must-revalidate')
    ) {
      return false
    }

    const window = resolveStaleWhileRevalidateWindow(
      responseHeaders,
      configured
    )

    return window > 0 &&
      Number.isFinite(record.expiresAt) &&
      Date.now() < record.expiresAt + window &&
      restoreCacheEntry(record, config) !== undefined
  } catch {
    return false
  }
}

function resolveStaleIfErrorWindow(
  headers: Headers,
  configured?: number
): number {
  const server = parseStaleIfError(headers.get('cache-control'))

  if (configured === undefined) {
    return server ?? 0
  }

  return server === undefined
    ? configured
    : Math.min(configured, server)
}

function resolveStaleWhileRevalidateWindow(
  headers: Headers,
  configured?: number
): number {
  const server = parseCacheDeltaSeconds(
    headers.get('cache-control'),
    'stale-while-revalidate'
  )

  if (configured === undefined) {
    return server ?? 0
  }

  return server === undefined
    ? configured
    : Math.min(configured, server)
}

function parseStaleIfError(value: string | null): number | undefined {
  return parseCacheDeltaSeconds(value, 'stale-if-error')
}

function parseCacheDeltaSeconds(
  value: string | null,
  expectedName: string
): number | undefined {
  let seconds: number | undefined

  if (!value) {
    return undefined
  }

  for (const item of value.split(',')) {
    const directive = item.trim()
    const separator = directive.indexOf('=')

    if (
      separator === -1 ||
      directive.slice(0, separator).trim().toLowerCase() !== expectedName
    ) {
      continue
    }

    if (seconds !== undefined) {
      return undefined
    }

    const candidate = directive.slice(separator + 1).trim()
    const match = /^(?:"(\d+)"|(\d+))$/.exec(candidate)

    if (!match) {
      return undefined
    }

    seconds = Number(match[1] ?? match[2])
  }

  if (seconds === undefined || !Number.isSafeInteger(seconds)) {
    return undefined
  }

  const milliseconds = seconds * 1000

  return Number.isSafeInteger(milliseconds)
    ? milliseconds
    : undefined
}

function hasCacheControlDirective(
  headers: Headers,
  expectedName: string
): boolean {
  return headers
    .get('cache-control')
    ?.split(',')
    .some(value => {
      const separator = value.indexOf('=')
      const name = separator === -1
        ? value
        : value.slice(0, separator)

      return name.trim().toLowerCase() === expectedName
    }) ?? false
}

function startBackgroundRefresh(
  context: PluginContext,
  refreshes: Map<string, AbortController>,
  key: string,
  config: RequestConfig,
  preserveRaw: boolean,
  recordEvent: RecordCacheEvent
): void {
  if (refreshes.has(key)) {
    return
  }

  const controller = new AbortController()
  const refreshConfig: RequestConfig = {
    ...config,
    signal: controller.signal
  }

  refreshes.set(key, controller)
  recordEvent('background-refresh')

  void Promise.resolve()
    .then(() => context.dispatch(refreshConfig, {
      background: true,
      preserveRaw
    }))
    .then(
      () => recordEvent('background-refresh-success'),
      () => recordEvent('background-refresh-error')
    )
    .finally(() => {
      if (refreshes.get(key) === controller) {
        refreshes.delete(key)
      }
    })
}

function abortBackgroundRefreshes(
  refreshes: Map<string, AbortController>
): void {
  for (const controller of refreshes.values()) {
    controller.abort('Cache background refresh stopped')
  }

  refreshes.clear()
}

function isEligibleStaleIfError(error: unknown): boolean {
  return error instanceof RequestError && (
    error.code === 'NETWORK_ERROR' ||
    error.code === 'TIMEOUT_ERROR' ||
    (
      error.code === 'HTTP_ERROR' &&
      error.status !== undefined &&
      error.status >= 500 &&
      error.status < 600
    )
  )
}

function canRevalidateCacheEntry(
  record: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean
): boolean {
  try {
    if (preserveRaw && !record.raw) {
      return false
    }

    const requestHeaders = new Headers(config.headers)

    if (
      requestHeaders.has('if-none-match') ||
      requestHeaders.has('if-modified-since') ||
      requestHeaders.has('range')
    ) {
      return false
    }

    return hasResponseValidator(new Headers(record.headers)) &&
      restoreCacheEntry(record, config) !== undefined
  } catch {
    return false
  }
}

function prepareConditionalRevalidation(
  config: RequestConfig,
  record: CacheEntry
): boolean {
  const storedHeaders = new Headers(record.headers)
  const etag = storedHeaders.get('etag')
  const lastModified = storedHeaders.get('last-modified')

  if (!etag && !lastModified) {
    return false
  }

  const headers = new Headers(config.headers)

  if (etag) {
    headers.set('if-none-match', etag)
  }

  if (lastModified) {
    headers.set('if-modified-since', lastModified)
  }

  const validateStatus = config.validateStatus

  config.headers = headers
  config.validateStatus = status => {
    return status === 304 || (
      validateStatus
        ? validateStatus(status)
        : status >= 200 && status < 300
    )
  }
  return true
}

function hasResponseValidator(headers: Headers): boolean {
  return headers.has('etag') || headers.has('last-modified')
}

function createRevalidatedResponse(
  record: CacheEntry,
  response: NporaResponse,
  config: RequestConfig
): NporaResponse {
  const headers = new Headers(record.headers)

  response.headers.forEach((value, name) => {
    headers.set(name, value)
  })

  return createCachedResponse({
    ...record,
    headers: [...headers.entries()]
  }, config)
}

function createCacheKey(
  config: RequestConfig,
  cache: CacheOptions,
  varyHeaders: readonly string[],
  emptyHeaderValues: ReadonlyArray<[string, string | null]>,
  memo: CacheKeyMemo
): string {
  if (cache.key) {
    return cache.key
  }

  const method = config.method ?? 'GET'
  const responseType = config.responseType ?? 'auto'
  const bare = !config.headers && !config.query && !config.searchParams

  if (
    bare &&
    memo.key !== undefined &&
    memo.method === method &&
    memo.baseURL === config.baseURL &&
    memo.url === config.url &&
    memo.responseType === responseType
  ) {
    return memo.key
  }

  const key = JSON.stringify({
    method,
    baseURL: config.baseURL,
    url: config.url,
    query: bare
      ? EMPTY_QUERY
      : normalizeQuery(config.searchParams ?? config.query),
    responseType,
    headers: config.headers
      ? normalizeCacheHeaders(
          new Headers(config.headers),
          varyHeaders
        )
      : emptyHeaderValues
  })

  if (bare) {
    memo.method = method
    memo.baseURL = config.baseURL
    memo.url = config.url
    memo.responseType = responseType
    memo.key = key
  }

  return key
}

interface CacheKeyMemo {
  method?: HttpMethod
  baseURL?: string
  url?: string
  responseType?: string
  key?: string
}

function normalizeCacheHeaders(
  headers: Headers | undefined,
  varyHeaders: readonly string[]
): Array<[string, string | null]> {
  const values: Array<[string, string | null]> = []

  headers?.forEach((value, name) => {
    if (!isRequestCacheControlHeader(name)) {
      values.push([name, value])
    }
  })

  for (const name of varyHeaders) {
    if (
      !isRequestCacheControlHeader(name) &&
      !headers?.has(name)
    ) {
      values.push([name, null])
    }
  }

  return values.sort(([first], [second]) => {
    return first.localeCompare(second)
  })
}

function isRequestCacheControlHeader(name: string): boolean {
  return name === 'cache-control' || name === 'pragma'
}

function normalizeVaryHeaders(
  headers: readonly string[]
): readonly string[] {
  return [...new Set(headers.map(name => name.toLowerCase()))]
}

function normalizeQuery(
  query?: QueryParams | URLSearchParams
): ReadonlyArray<[string, string]> {
  if (!query) {
    return EMPTY_QUERY
  }

  if (isURLSearchParams(query)) {
    return [...query.entries()]
  }

  const entries: Array<[string, string]> = []

  for (const key of Object.keys(query).sort()) {
    appendQueryValue(entries, key, query[key])
  }

  return entries
}

function appendQueryValue(
  entries: Array<[string, string]>,
  key: string,
  value: QueryParams[string]
): void {
  if (value === undefined) {
    return
  }

  if (value === null) {
    entries.push([key, ''])
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(entries, key, item)
    }

    return
  }

  entries.push([key, String(value)])
}

function cloneRawResponse(record: CacheEntry): Response {
  if (record.raw) {
    const cloned = cloneResponse(record.raw)

    if (cloned) {
      return new Response(cloned.body, {
        status: record.status,
        statusText: record.statusText,
        headers: record.headers
      })
    }
  }

  return new Response(null, {
    status: record.status,
    statusText: record.statusText,
    headers: record.headers
  })
}

function cloneResponse(response: Response): Response | undefined {
  try {
    return response.clone()
  } catch {
    return undefined
  }
}

function cloneCacheValue<T>(value: T): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof structuredClone !== 'function'
  ) {
    return value
  }

  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function normalizeMaxEntries(value?: number): number {
  if (value === undefined) {
    return 1000
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.POSITIVE_INFINITY : 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeCacheTtl(
  value: number | undefined,
  config: RequestConfig
): number {
  const ttl = value ?? 30000

  if (
    ttl !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(ttl) || ttl < 0)
  ) {
    throw new RequestError(
      'Cache ttl must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return ttl
}

function normalizeCacheStatus(
  value: number | undefined,
  config: RequestConfig
): number {
  const status = value ?? 200

  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new RequestError(
      'Cache status must be an integer between 200 and 599',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return status
}

function normalizeStaleIfError(
  value: number | undefined,
  config: RequestConfig
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    value !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(value) || value < 0)
  ) {
    throw new RequestError(
      'Cache staleIfError must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return value
}

function normalizeStaleWhileRevalidate(
  value: number | undefined,
  config: RequestConfig
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    value !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(value) || value < 0)
  ) {
    throw new RequestError(
      'Cache staleWhileRevalidate must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return value
}

function normalizeCacheTags(
  input: string | readonly string[] | undefined,
  config?: RequestConfig
): readonly string[] {
  if (input === undefined) {
    return []
  }

  if (typeof input !== 'string' && !Array.isArray(input)) {
    throw new RequestError('Cache tags must be an array of strings', {
      code: 'CONFIG_ERROR',
      config
    })
  }

  const values = typeof input === 'string' ? [input] : input

  if (values.length > MAX_CACHE_TAGS) {
    throw new RequestError(
      `Cache tags cannot contain more than ${MAX_CACHE_TAGS} values`,
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  const tags = new Set<string>()

  for (const tag of values) {
    if (
      typeof tag !== 'string' ||
      tag.length === 0 ||
      tag.length > MAX_CACHE_TAG_LENGTH
    ) {
      throw new RequestError(
        `Cache tags must contain 1 to ${MAX_CACHE_TAG_LENGTH} characters`,
        {
          code: 'CONFIG_ERROR',
          config
        }
      )
    }

    tags.add(tag)
  }

  return [...tags]
}

interface WebStorageRecord {
  entry: CacheEntry
  accessedAt: number
}

function createWebStoragePrefix(namespace = 'default'): string {
  if (
    typeof namespace !== 'string' ||
    namespace.length === 0 ||
    namespace.length > 128
  ) {
    throw new RequestError(
      'Web storage cache namespace must contain 1 to 128 characters',
      { code: 'CONFIG_ERROR' }
    )
  }

  return `@npora/request:${encodeURIComponent(namespace)}:`
}

function serializeWebStorageEntry(
  entry: CacheEntry,
  accessedAt: number
): string {
  return JSON.stringify({
    version: 1,
    data: entry.data,
    expiresAt: entry.expiresAt === Number.POSITIVE_INFINITY
      ? null
      : entry.expiresAt,
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
    tags: entry.tags,
    accessedAt
  })
}

function parseWebStorageEntry(value: string): WebStorageRecord {
  const record = JSON.parse(value) as Record<string, unknown>
  const expiresAt = record.expiresAt === null
    ? Number.POSITIVE_INFINITY
    : record.expiresAt

  if (
    record.version !== 1 ||
    (
      expiresAt !== Number.POSITIVE_INFINITY &&
      (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt))
    ) ||
    typeof record.status !== 'number' ||
    !Number.isInteger(record.status) ||
    record.status < 200 ||
    record.status > 599 ||
    typeof record.statusText !== 'string' ||
    !Array.isArray(record.headers) ||
    typeof record.accessedAt !== 'number' ||
    !Number.isFinite(record.accessedAt)
  ) {
    throw new TypeError('Invalid web storage cache entry')
  }

  const tags = record.tags === undefined
    ? undefined
    : normalizeCacheTags(record.tags as readonly string[])

  return {
    entry: {
      data: record.data,
      expiresAt,
      status: record.status,
      statusText: record.statusText,
      headers: [...new Headers(record.headers as HeadersInit).entries()],
      tags: tags && tags.length > 0 ? tags : undefined
    },
    accessedAt: record.accessedAt
  }
}

function isExpired(expiresAt: number): boolean {
  return expiresAt !== Number.POSITIVE_INFINITY &&
    (Number.isNaN(expiresAt) || Date.now() >= expiresAt)
}
