import type {
  IndexedDBCacheRecord,
  IndexedDBCleanupSummary,
  IndexedDBCacheStoreEvent
} from './indexedDBCacheTypes'
import {
  STORE_NAME, NAMESPACE_INDEX, waitForTransaction, visitCursor
} from './indexedDBCacheTransactions'
import { classifyIndexedDBRecord, addCleanupSummary } from './indexedDBCacheRecords'

export async function pruneOlderSchemaRecords(
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
