import type { HttpMethod } from '../types'
import { MemoryCacheStore } from './cacheStores'
import type {
  CacheEntry,
  CacheRefreshLease,
  CacheStore
} from './cacheStores'
import { normalizeCacheHeaders, normalizeVaryHeaders } from './cacheKey'
import type { CacheKeyMemo } from './cacheKey'
import type {
  CacheGeneration,
  InFlightRequest,
  KeyGeneration
} from './cacheShared'
import type { CachePluginOptions } from './cacheTypes'
import { createCacheStats, createCacheEventRecorder } from './cacheEvents'

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

/** State is shared by a plugin's mutations and installed lifecycle hooks. */
export function createCacheState(options: CachePluginOptions) {
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
  const generation = 0
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

  return {
    store,
    cacheHits,
    leaders,
    requestGenerations,
    automaticInvalidations,
    unsharedGenerations,
    completedRecords,
    revalidations,
    forcedRevalidations,
    noStoreRequests,
    staleFallbacks,
    refreshLeases,
    cacheFallbacks,
    uncacheableLeaders,
    inFlight,
    rawInFlight,
    rawLeaders,
    backgroundRefreshes,
    keyGenerations,
    keyOperations,
    tagInvalidations,
    stats,
    recordEvent,
    generation,
    methods,
    varyHeaders,
    emptyHeaderValues,
    keyMemo
  }
}

export type CacheState = ReturnType<typeof createCacheState>
