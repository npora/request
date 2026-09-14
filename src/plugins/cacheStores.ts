import { RequestError } from '../errors'
import { normalizeCacheTags } from './cacheValidation'

export type MaybePromise<T> = T | Promise<T>

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

function normalizeMaxEntries(value?: number): number {
  if (value === undefined) {
    return 1000
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.POSITIVE_INFINITY : 0
  }

  return Math.max(0, Math.floor(value))
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
