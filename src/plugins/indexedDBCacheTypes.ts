import type { CacheEntry } from './cacheStores'

export interface IndexedDBCacheStoreOptions {
  /** Database shared by cache namespaces. @default @npora/request-cache */
  databaseName?: string

  /** Isolates this cache from other applications in the database. */
  namespace?: string

  /** Maximum entries retained with LRU eviction. @default 1000 */
  maxEntries?: number

  /**
   * Approximate structured-clone byte budget retained with LRU eviction.
   * @default Infinity
   */
  maxBytes?: number

  /** Retry quota-exceeded writes after LRU recovery. @default true */
  quotaRecovery?: boolean

  /** Decide whether an otherwise eligible entry should be persisted. */
  shouldPersist?: (
    entry: Readonly<CacheEntry>,
    estimatedBytes: number
  ) => boolean | Promise<boolean>

  /** Observe privacy-safe persistence and eviction decisions. */
  onEvent?: (
    event: IndexedDBCacheStoreEvent
  ) => void | Promise<void>

  /** Monotonic application cache schema version. @default 1 */
  schemaVersion?: number
}

export interface IndexedDBCacheUsage {
  entries: number
  estimatedBytes: number
  maxEntries: number
  maxBytes: number
  schemaVersion: number
}

export interface IndexedDBCacheCompactionOptions {
  /** Remove entries expiring at or before this time. @default Date.now() */
  expiredBefore?: number

  /** Bound removals performed by one maintenance transaction. @default Infinity */
  maxRemovals?: number
}

export interface IndexedDBCacheCompactionResult {
  scannedEntries: number
  removedEntries: number
  estimatedBytesFreed: number
  expiredBefore: number
  hasMore: boolean
}

export interface IndexedDBCacheStoreEvent {
  type: 'eviction' | 'rejection'
  reason:
    | 'max-entries'
    | 'max-bytes'
    | 'quota-recovery'
    | 'schema-version'
    | 'malformed'
    | 'oversized'
    | 'admission-policy'
    | 'expired'
  entries: number
  estimatedBytes: number
  timestamp: number
}

export interface IndexedDBCacheRecord extends CacheEntry {
  key: string
  namespace: string
  accessedAt: number
  schemaVersion?: number
  size?: number
}

export interface IndexedDBCleanupSummary {
  reason: IndexedDBCacheStoreEvent['reason']
  entries: number
  estimatedBytes: number
}

export type IndexedDBRecordDisposition =
  | 'current'
  | 'future'
  | 'schema-version'
  | 'malformed'
