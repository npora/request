import { RequestError } from '../errors'
import type { CacheEntry, CacheStore } from './cacheStores'
import type {
  IndexedDBCacheStoreOptions, IndexedDBCacheUsage,
  IndexedDBCacheCompactionOptions, IndexedDBCacheCompactionResult,
  IndexedDBCacheStoreEvent, IndexedDBCacheRecord, IndexedDBCleanupSummary
} from './indexedDBCacheTypes'
import {
  STORE_NAME, NAMESPACE_INDEX, openCacheDatabase,
  waitForRequest, waitForTransaction, visitCursor
} from './indexedDBCacheTransactions'
import {
  toPortableCacheEntry, isValidIndexedDBRecord, classifyIndexedDBRecord,
  isFutureIndexedDBRecord, readIndexedDBRecordSize, estimateStructuredCloneSize,
  addSizes, addCleanupSummary, isQuotaExceededError
} from './indexedDBCacheRecords'
import {
  normalizeIndexedDBName, normalizeIndexedDBMaxEntries, normalizeIndexedDBMaxBytes,
  normalizeQuotaRecovery, normalizeIndexedDBEventObserver,
  normalizeIndexedDBAdmissionPolicy, normalizeCompactionBoundary,
  normalizeCompactionMaxRemovals, normalizeIndexedDBSchemaVersion
} from './indexedDBCacheValidation'
import { pruneOlderSchemaRecords } from './indexedDBCacheMaintenance'

export type {
  IndexedDBCacheStoreOptions, IndexedDBCacheUsage,
  IndexedDBCacheCompactionOptions, IndexedDBCacheCompactionResult,
  IndexedDBCacheStoreEvent
} from './indexedDBCacheTypes'

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
