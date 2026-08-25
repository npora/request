import { RequestError } from '../errors'
import type { CacheEntry, CacheStore } from './cachePlugin'

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

interface IndexedDBCacheRecord extends CacheEntry {
  key: string
  namespace: string
  accessedAt: number
  schemaVersion?: number
  size?: number
}

interface IndexedDBCleanupSummary {
  reason: IndexedDBCacheStoreEvent['reason']
  entries: number
  estimatedBytes: number
}

type IndexedDBRecordDisposition =
  | 'current'
  | 'future'
  | 'schema-version'
  | 'malformed'

const STORE_NAME = 'entries'
const NAMESPACE_INDEX = 'namespace'

/** A namespaced asynchronous cache backed by IndexedDB. */
export class IndexedDBCacheStore implements CacheStore {
  private readonly namespace: string

  private readonly maxEntries: number

  private readonly maxBytes: number

  private readonly quotaRecovery: boolean

  private readonly shouldPersist?: IndexedDBCacheStoreOptions['shouldPersist']

  private readonly onEvent?: IndexedDBCacheStoreOptions['onEvent']

  private readonly factory: IDBFactory

  private readonly databaseName: string

  private readonly schemaVersion: number

  private database?: Promise<IDBDatabase>

  constructor(
    factory: IDBFactory,
    options: IndexedDBCacheStoreOptions = {}
  ) {
    this.namespace = normalizeIndexedDBName(
      options.namespace,
      'namespace',
      'default'
    )
    this.maxEntries = normalizeIndexedDBMaxEntries(options.maxEntries)
    this.maxBytes = normalizeIndexedDBMaxBytes(options.maxBytes)
    this.quotaRecovery = normalizeQuotaRecovery(options.quotaRecovery)
    this.shouldPersist = normalizeIndexedDBAdmissionPolicy(
      options.shouldPersist
    )
    this.onEvent = normalizeIndexedDBEventObserver(options.onEvent)
    this.schemaVersion = normalizeIndexedDBSchemaVersion(
      options.schemaVersion
    )
    this.databaseName = normalizeIndexedDBName(
      options.databaseName,
      'database name',
      '@npora/request-cache'
    )
    this.factory = factory
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    if (this.maxEntries === 0 || this.maxBytes === 0) {
      await this.delete(key)
      return undefined
    }

    const database = await this.getDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = waitForTransaction(transaction)
    const store = transaction.objectStore(STORE_NAME)
    const storageKey = this.createKey(key)
    const record = await waitForRequest<IndexedDBCacheRecord | undefined>(
      store.get(storageKey)
    )
    const future = isFutureIndexedDBRecord(record, this.schemaVersion)

    if (
      !isValidIndexedDBRecord(
        record,
        this.namespace,
        storageKey,
        this.schemaVersion
      )
    ) {
      if (record !== undefined && !future) {
        store.delete(storageKey)
      }

      await done
      if (record !== undefined && !future) {
        this.emitEvent({
          type: 'eviction',
          reason: 'malformed',
          entries: 1,
          estimatedBytes: readIndexedDBRecordSize(record)
        })
      }
      return undefined
    }

    record.accessedAt = Date.now()
    record.size = readIndexedDBRecordSize(record)
    store.put(record)
    await done
    return toPortableCacheEntry(record)
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.maxEntries === 0 || this.maxBytes === 0) {
      await this.delete(key)
      return
    }

    const database = await this.getDatabase()
    const record: IndexedDBCacheRecord = {
      ...toPortableCacheEntry(entry),
      key: this.createKey(key),
      namespace: this.namespace,
      accessedAt: Date.now(),
      schemaVersion: this.schemaVersion
    }
    record.size = estimateStructuredCloneSize(record)

    if (record.size > this.maxBytes) {
      await this.delete(key)
      this.emitEvent({
        type: 'rejection',
        reason: 'oversized',
        entries: 1,
        estimatedBytes: record.size
      })
      return
    }

    const admission = this.shouldPersist
      ? await this.shouldPersist(toPortableCacheEntry(record), record.size)
      : true

    if (typeof admission !== 'boolean') {
      throw new RequestError(
        'IndexedDB cache shouldPersist must return a boolean',
        { code: 'CONFIG_ERROR' }
      )
    }

    if (!admission) {
      await this.delete(key)
      this.emitEvent({
        type: 'rejection',
        reason: 'admission-policy',
        entries: 1,
        estimatedBytes: record.size
      })
      return
    }

    try {
      await this.writeRecord(database, record)
    } catch (error) {
      if (
        !this.quotaRecovery ||
        !isQuotaExceededError(error) ||
        !await this.recoverQuota(database)
      ) {
        throw error
      }

      await this.writeRecord(database, record)
    }
  }

  async delete(key: string): Promise<void> {
    const database = await this.getDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = waitForTransaction(transaction)
    const store = transaction.objectStore(STORE_NAME)
    const storageKey = this.createKey(key)
    const record = await waitForRequest<IndexedDBCacheRecord | undefined>(
      store.get(storageKey)
    )

    if (!isFutureIndexedDBRecord(record, this.schemaVersion)) {
      store.delete(storageKey)
    }
    await done
  }

  async invalidateTags(tags: readonly string[]): Promise<number> {
    const expected = new Set(tags)
    let deleted = 0

    await this.visitNamespace(record => {
      if (record.tags?.some(tag => expected.has(tag))) {
        deleted += 1
        return true
      }

      return false
    })

    return deleted
  }

  async clear(): Promise<void> {
    await this.visitNamespace(() => true)
  }

  /** Inspect current-schema usage without exposing cache keys. */
  async getUsage(): Promise<IndexedDBCacheUsage> {
    const database = await this.getDatabase()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const done = waitForTransaction(transaction)
    const request = transaction
      .objectStore(STORE_NAME)
      .index(NAMESPACE_INDEX)
      .openCursor(this.namespace)
    let entries = 0
    let estimatedBytes = 0

    await visitCursor(request, cursor => {
      const record = cursor.value as IndexedDBCacheRecord

      if (isValidIndexedDBRecord(
        record,
        this.namespace,
        undefined,
        this.schemaVersion
      )) {
        entries += 1
        estimatedBytes = addSizes(
          estimatedBytes,
          readIndexedDBRecordSize(record)
        )
      }
    })

    await done
    return {
      entries,
      estimatedBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      schemaVersion: this.schemaVersion
    }
  }

  /** Remove current-schema entries older than an explicit stale boundary. */
  async compact(
    options: IndexedDBCacheCompactionOptions = {}
  ): Promise<IndexedDBCacheCompactionResult> {
    const expiredBefore = normalizeCompactionBoundary(
      options.expiredBefore
    )
    const maxRemovals = normalizeCompactionMaxRemovals(
      options.maxRemovals
    )
    const database = await this.getDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = waitForTransaction(transaction)
    const request = transaction
      .objectStore(STORE_NAME)
      .index(NAMESPACE_INDEX)
      .openCursor(this.namespace)
    const summaries = new Map<
      IndexedDBCacheStoreEvent['reason'],
      IndexedDBCleanupSummary
    >()
    let scannedEntries = 0
    let removedEntries = 0
    let estimatedBytesFreed = 0
    let hasMore = false

    await visitCursor(request, cursor => {
      const record = cursor.value as IndexedDBCacheRecord
      const disposition = classifyIndexedDBRecord(
        record,
        this.namespace,
        this.schemaVersion
      )
      scannedEntries += 1

      if (
        disposition === 'malformed' ||
        disposition === 'schema-version'
      ) {
        cursor.delete()
        addCleanupSummary(
          summaries,
          disposition,
          record
        )
        removedEntries += 1
        estimatedBytesFreed = addSizes(
          estimatedBytesFreed,
          readIndexedDBRecordSize(record)
        )
      } else if (
        disposition === 'current' &&
        record.expiresAt <= expiredBefore
      ) {
        const size = readIndexedDBRecordSize(record)

        cursor.delete()
        addCleanupSummary(summaries, 'expired', record)
        removedEntries += 1
        estimatedBytesFreed = addSizes(estimatedBytesFreed, size)
      }

      if (removedEntries >= maxRemovals) {
        hasMore = true
        return false
      }
    })
    await done
    this.emitCleanupSummaries(summaries.values())

    return {
      scannedEntries,
      removedEntries,
      estimatedBytesFreed,
      expiredBefore,
      hasMore
    }
  }

  /** Close this store's database connection. */
  async close(): Promise<void> {
    const pending = this.database

    if (!pending) {
      return
    }

    this.database = undefined
    const database = await pending

    database.close()
  }

  private createKey(key: string): string {
    return this.schemaVersion === 1
      ? `${this.namespace}\0${key}`
      : `${this.namespace}\0@npora-schema:${this.schemaVersion}\0${key}`
  }

  private async writeRecord(
    database: IDBDatabase,
    record: IndexedDBCacheRecord
  ): Promise<void> {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = waitForTransaction(transaction)
    const store = transaction.objectStore(STORE_NAME)
    const summaries = new Map<
      IndexedDBCacheStoreEvent['reason'],
      IndexedDBCleanupSummary
    >()
    const existing = await waitForRequest<IndexedDBCacheRecord | undefined>(
      store.get(record.key)
    )

    if (isFutureIndexedDBRecord(existing, this.schemaVersion)) {
      await done
      return
    }

    store.put(record)

    if (
      this.maxEntries !== Number.POSITIVE_INFINITY ||
      this.maxBytes !== Number.POSITIVE_INFINITY
    ) {
      const storedRecords = await waitForRequest<IndexedDBCacheRecord[]>(
        store.index(NAMESPACE_INDEX).getAll(this.namespace)
      )
      const records: IndexedDBCacheRecord[] = []

      for (const candidate of storedRecords) {
        const disposition = classifyIndexedDBRecord(
          candidate,
          this.namespace,
          this.schemaVersion
        )

        if (
          disposition === 'malformed' ||
          disposition === 'schema-version'
        ) {
          store.delete(candidate.key)
          addCleanupSummary(
            summaries,
            disposition,
            candidate
          )
        } else if (disposition === 'current') {
          records.push(candidate)
        }
      }

      records.sort((first, second) => {
        if (first.key === record.key) {
          return 1
        }

        if (second.key === record.key) {
          return -1
        }

        return first.accessedAt - second.accessedAt ||
          first.key.localeCompare(second.key)
      })

      let totalBytes = records.reduce(
        (total, candidate) => addSizes(
          total,
          readIndexedDBRecordSize(candidate)
        ),
        0
      )
      let retained = records.length

      for (const candidate of records) {
        if (
          retained <= this.maxEntries &&
          totalBytes <= this.maxBytes
        ) {
          break
        }

        store.delete(candidate.key)
        addCleanupSummary(
          summaries,
          totalBytes > this.maxBytes ? 'max-bytes' : 'max-entries',
          candidate
        )
        retained -= 1
        totalBytes = Math.max(
          0,
          totalBytes - readIndexedDBRecordSize(candidate)
        )
      }
    }

    await done
    this.emitCleanupSummaries(summaries.values())
  }

  private async recoverQuota(
    database: IDBDatabase
  ): Promise<boolean> {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = waitForTransaction(transaction)
    const store = transaction.objectStore(STORE_NAME)
    const storedRecords = await waitForRequest<IndexedDBCacheRecord[]>(
      store.index(NAMESPACE_INDEX).getAll(this.namespace)
    )
    const records: IndexedDBCacheRecord[] = []
    const summaries = new Map<
      IndexedDBCacheStoreEvent['reason'],
      IndexedDBCleanupSummary
    >()
    let deleted = false

    for (const candidate of storedRecords) {
      const disposition = classifyIndexedDBRecord(
        candidate,
        this.namespace,
        this.schemaVersion
      )

      if (
        disposition === 'malformed' ||
        disposition === 'schema-version'
      ) {
        store.delete(candidate.key)
        addCleanupSummary(
          summaries,
          disposition,
          candidate
        )
        deleted = true
      } else if (disposition === 'current') {
        records.push(candidate)
      }
    }

    records.sort((first, second) => (
      first.accessedAt - second.accessedAt ||
      first.key.localeCompare(second.key)
    ))

    for (const candidate of records.slice(0, Math.max(
      1,
      Math.ceil(records.length / 2)
    ))) {
      store.delete(candidate.key)
      addCleanupSummary(summaries, 'quota-recovery', candidate)
      deleted = true
    }

    await done
    this.emitCleanupSummaries(summaries.values())
    return deleted
  }

  private emitCleanupSummaries(
    summaries: Iterable<IndexedDBCleanupSummary>
  ): void {
    for (const summary of summaries) {
      this.emitEvent({
        type: 'eviction',
        ...summary
      })
    }
  }

  private emitEvent(
    event: Omit<IndexedDBCacheStoreEvent, 'timestamp'>
  ): void {
    if (!this.onEvent) {
      return
    }

    try {
      void Promise.resolve(this.onEvent({
        ...event,
        timestamp: Date.now()
      })).catch(() => {})
    } catch {
      // Observers cannot affect storage behavior.
    }
  }

  private async visitNamespace(
    shouldDelete: (record: IndexedDBCacheRecord) => boolean
  ): Promise<void> {
    const database = await this.getDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = waitForTransaction(transaction)
    const request = transaction
      .objectStore(STORE_NAME)
      .index(NAMESPACE_INDEX)
      .openCursor(this.namespace)
    const summaries = new Map<
      IndexedDBCacheStoreEvent['reason'],
      IndexedDBCleanupSummary
    >()

    await visitCursor(request, cursor => {
      const record = cursor.value as IndexedDBCacheRecord
      const disposition = classifyIndexedDBRecord(
        record,
        this.namespace,
        this.schemaVersion
      )

      if (
        disposition === 'malformed' ||
        disposition === 'schema-version' ||
        (
          disposition === 'current' &&
          shouldDelete(record)
        )
      ) {
        cursor.delete()
        if (
          disposition === 'malformed' ||
          disposition === 'schema-version'
        ) {
          addCleanupSummary(
            summaries,
            disposition,
            record
          )
        }
      }
    })
    await done
    this.emitCleanupSummaries(summaries.values())
  }

  private getDatabase(): Promise<IDBDatabase> {
    this.database ??= openCacheDatabase(
      this.factory,
      this.databaseName
    ).then(async database => {
      try {
        const summaries = await pruneOlderSchemaRecords(
          database,
          this.namespace,
          this.schemaVersion
        )
        this.emitCleanupSummaries(summaries)
        return database
      } catch (error) {
        database.close()
        throw error
      }
    })
    return this.database
  }
}

function openCacheDatabase(
  factory: IDBFactory,
  name: string
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database
          .createObjectStore(STORE_NAME, { keyPath: 'key' })
          .createIndex(NAMESPACE_INDEX, NAMESPACE_INDEX, { unique: false })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result

      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    const rejectWithTransactionError = (event: Event) => {
      reject(
        transaction.error ??
        readIDBRequestError(event.target) ??
        new Error('IndexedDB transaction failed')
      )
    }

    transaction.onabort = rejectWithTransactionError
    transaction.onerror = rejectWithTransactionError
    transaction.oncomplete = () => resolve()
  })

  void result.catch(() => {})
  return result
}

function readIDBRequestError(target: EventTarget | null): DOMException | null {
  if (!target || !('error' in target)) {
    return null
  }

  const error = (target as { error?: unknown }).error

  return error instanceof DOMException ? error : null
}

function visitCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
  visitor: (cursor: IDBCursorWithValue) => void | boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result

      if (!cursor) {
        resolve()
        return
      }

      try {
        if (visitor(cursor) === false) {
          resolve()
          return
        }
      } catch (error) {
        try {
          readCursorTransaction(request)?.abort()
        } catch {
          // The original visitor error is more actionable than abort failure.
        }

        reject(error)
        return
      }

      cursor.continue()
    }
  })
}

function readCursorTransaction(
  request: IDBRequest<IDBCursorWithValue | null>
): IDBTransaction | undefined {
  const source = request.source

  if (!source) {
    return undefined
  }

  if ('transaction' in source) {
    return source.transaction
  }

  if ('objectStore' in source) {
    return source.objectStore.transaction
  }

  return 'transaction' in source.source
    ? source.source.transaction
    : source.source.objectStore.transaction
}

function toPortableCacheEntry(entry: CacheEntry): CacheEntry {
  return {
    data: entry.data,
    expiresAt: entry.expiresAt,
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
    tags: entry.tags
  }
}

function isValidIndexedDBRecord(
  value: unknown,
  namespace: string,
  key?: string,
  schemaVersion = 1
): value is IndexedDBCacheRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as IndexedDBCacheRecord

  if (!(
    typeof record.key === 'string' &&
    (key === undefined || record.key === key) &&
    record.namespace === namespace &&
    readIndexedDBSchemaVersion(record) === schemaVersion &&
    (
      record.expiresAt === Number.POSITIVE_INFINITY ||
      Number.isFinite(record.expiresAt)
    ) &&
    Number.isInteger(record.status) &&
    record.status >= 200 &&
    record.status <= 599 &&
    typeof record.statusText === 'string' &&
    Array.isArray(record.headers) &&
    (record.tags === undefined || (
      Array.isArray(record.tags) &&
      record.tags.length <= 32 &&
      record.tags.every(tag => (
        typeof tag === 'string' &&
        tag.length > 0 &&
        tag.length <= 128
      ))
    )) &&
    Number.isFinite(record.accessedAt)
  )) {
    return false
  }

  try {
    new Headers(record.headers)
    return true
  } catch {
    return false
  }
}

function readIndexedDBSchemaVersion(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion ?? 1

  return Number.isSafeInteger(version) &&
    (version as number) >= 1 &&
    (version as number) <= 1000000000
    ? version as number
    : undefined
}

function classifyIndexedDBRecord(
  record: unknown,
  namespace: string,
  schemaVersion: number
): IndexedDBRecordDisposition {
  const version = readIndexedDBSchemaVersion(record)

  if (version === undefined) {
    return 'malformed'
  }

  if (version > schemaVersion) {
    return 'future'
  }

  if (version < schemaVersion) {
    return 'schema-version'
  }

  return isValidIndexedDBRecord(
    record,
    namespace,
    undefined,
    schemaVersion
  ) ? 'current' : 'malformed'
}

function isFutureIndexedDBRecord(
  record: unknown,
  schemaVersion: number
): boolean {
  const version = readIndexedDBSchemaVersion(record)

  return version !== undefined && version > schemaVersion
}

function readIndexedDBRecordSize(record: unknown): number {
  const size = record && typeof record === 'object'
    ? (record as { size?: unknown }).size
    : undefined

  return Number.isSafeInteger(size) && (size as number) >= 0
    ? size as number
    : estimateStructuredCloneSize(record)
}

function estimateStructuredCloneSize(
  value: unknown,
  seen = new WeakSet<object>()
): number {
  if (value === undefined || value === null) {
    return 0
  }

  if (typeof value === 'string') {
    return Math.min(Number.MAX_SAFE_INTEGER, value.length * 2)
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return 8
  }

  if (typeof value === 'boolean') {
    return 4
  }

  if (typeof value !== 'object') {
    return 0
  }

  if (seen.has(value)) {
    return 8
  }

  seen.add(value)

  if (value instanceof Date) {
    return 8
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.size
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }

  if (value instanceof Map) {
    let size = 16

    for (const [key, item] of value) {
      size = addSizes(
        size,
        estimateStructuredCloneSize(key, seen),
        estimateStructuredCloneSize(item, seen)
      )
    }

    return size
  }

  if (value instanceof Set) {
    let size = 16

    for (const item of value) {
      size = addSizes(size, estimateStructuredCloneSize(item, seen))
    }

    return size
  }

  let size = Array.isArray(value) ? 16 : 32

  for (const [key, item] of Object.entries(value)) {
    size = addSizes(
      size,
      key.length * 2,
      estimateStructuredCloneSize(item, seen)
    )
  }

  return size
}

function addSizes(...values: number[]): number {
  let total = 0

  for (const value of values) {
    if (value >= Number.MAX_SAFE_INTEGER - total) {
      return Number.MAX_SAFE_INTEGER
    }

    total += value
  }

  return total
}

function addCleanupSummary(
  summaries: Map<
    IndexedDBCacheStoreEvent['reason'],
    IndexedDBCleanupSummary
  >,
  reason: IndexedDBCacheStoreEvent['reason'],
  record: unknown
): void {
  const existing = summaries.get(reason)
  const estimatedBytes = readIndexedDBRecordSize(record)

  if (existing) {
    existing.entries += 1
    existing.estimatedBytes = addSizes(
      existing.estimatedBytes,
      estimatedBytes
    )
    return
  }

  summaries.set(reason, {
    reason,
    entries: 1,
    estimatedBytes
  })
}

function isQuotaExceededError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'QuotaExceededError'
  )
}

async function pruneOlderSchemaRecords(
  database: IDBDatabase,
  namespace: string,
  schemaVersion: number
): Promise<IndexedDBCleanupSummary[]> {
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const done = waitForTransaction(transaction)
  const request = transaction
    .objectStore(STORE_NAME)
    .index(NAMESPACE_INDEX)
    .openCursor(namespace)
  const summaries = new Map<
    IndexedDBCacheStoreEvent['reason'],
    IndexedDBCleanupSummary
  >()

  await visitCursor(request, cursor => {
    const record = cursor.value as IndexedDBCacheRecord
    const disposition = classifyIndexedDBRecord(
      record,
      namespace,
      schemaVersion
    )

    if (
      disposition === 'malformed' ||
      disposition === 'schema-version'
    ) {
      cursor.delete()
      addCleanupSummary(
        summaries,
        disposition,
        record
      )
    }
  })
  await done
  return [...summaries.values()]
}

function normalizeIndexedDBName(
  value: string | undefined,
  label: string,
  fallback: string
): string {
  const name = value ?? fallback

  if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
    throw new RequestError(
      `IndexedDB cache ${label} must contain 1 to 128 characters`,
      { code: 'CONFIG_ERROR' }
    )
  }

  return name
}

function normalizeIndexedDBMaxEntries(value?: number): number {
  if (value === undefined) {
    return 1000
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.POSITIVE_INFINITY : 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeIndexedDBMaxBytes(value?: number): number {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY
  }

  if (value === Number.POSITIVE_INFINITY) {
    return value
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RequestError(
      'IndexedDB cache maxBytes must be a non-negative safe integer or Infinity',
      { code: 'CONFIG_ERROR' }
    )
  }

  return value
}

function normalizeQuotaRecovery(value?: boolean): boolean {
  if (value === undefined) {
    return true
  }

  if (typeof value !== 'boolean') {
    throw new RequestError(
      'IndexedDB cache quotaRecovery must be a boolean',
      { code: 'CONFIG_ERROR' }
    )
  }

  return value
}

function normalizeIndexedDBEventObserver(
  value?: IndexedDBCacheStoreOptions['onEvent']
): IndexedDBCacheStoreOptions['onEvent'] {
  if (value !== undefined && typeof value !== 'function') {
    throw new RequestError(
      'IndexedDB cache onEvent must be a function',
      { code: 'CONFIG_ERROR' }
    )
  }

  return value
}

function normalizeIndexedDBAdmissionPolicy(
  value?: IndexedDBCacheStoreOptions['shouldPersist']
): IndexedDBCacheStoreOptions['shouldPersist'] {
  if (value !== undefined && typeof value !== 'function') {
    throw new RequestError(
      'IndexedDB cache shouldPersist must be a function',
      { code: 'CONFIG_ERROR' }
    )
  }

  return value
}

function normalizeCompactionBoundary(value?: number): number {
  const boundary = value ?? Date.now()

  if (!Number.isFinite(boundary)) {
    throw new RequestError(
      'IndexedDB cache compact expiredBefore must be finite',
      { code: 'CONFIG_ERROR' }
    )
  }

  return boundary
}

function normalizeCompactionMaxRemovals(value?: number): number {
  if (value === undefined || value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RequestError(
      'IndexedDB cache compact maxRemovals must be a positive safe integer or Infinity',
      { code: 'CONFIG_ERROR' }
    )
  }

  return value
}

function normalizeIndexedDBSchemaVersion(value?: number): number {
  const version = value ?? 1

  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 1000000000
  ) {
    throw new RequestError(
      'IndexedDB cache schemaVersion must be an integer from 1 to 1000000000',
      { code: 'CONFIG_ERROR' }
    )
  }

  return version
}
