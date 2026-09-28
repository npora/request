import { isPromiseLike } from '../utils/isPromiseLike'
import type {
  CacheEventType,
  CachePluginOptions,
  CacheStats
} from './cacheTypes'

export type RecordCacheEvent = (type: CacheEventType) => void

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

export function createCacheStats(): CacheStats {
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

export function resetCacheStats(stats: CacheStats): void {
  Object.assign(stats, createCacheStats())
}

export function createCacheEventRecorder(
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

export function ignoreCacheEventError(): void {
  // Async observers are isolated from request handling.
}
