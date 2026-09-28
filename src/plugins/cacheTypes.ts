import type { HttpMethod, RequestConfig } from '../types'
import type { Plugin } from './Plugin'
import type { CacheStore, MaybePromise } from './cacheStores'

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
