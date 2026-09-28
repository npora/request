import type { CacheEntry } from './cacheStores'
import type {
  IndexedDBCacheRecord,
  IndexedDBCleanupSummary,
  IndexedDBRecordDisposition,
  IndexedDBCacheStoreEvent
} from './indexedDBCacheTypes'
import { isArrayBuffer, isBlob } from '../utils/isBinaryBody'

export function toPortableCacheEntry(entry: CacheEntry): CacheEntry {
  return {
    data: entry.data,
    expiresAt: entry.expiresAt,
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
    tags: entry.tags
  }
}

export function isValidIndexedDBRecord(
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

export function readIndexedDBSchemaVersion(value: unknown): number | undefined {
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

export function classifyIndexedDBRecord(
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

export function isFutureIndexedDBRecord(
  record: unknown,
  schemaVersion: number
): boolean {
  const version = readIndexedDBSchemaVersion(record)

  return version !== undefined && version > schemaVersion
}

export function readIndexedDBRecordSize(record: unknown): number {
  const size = record && typeof record === 'object'
    ? (record as { size?: unknown }).size
    : undefined

  return Number.isSafeInteger(size) && (size as number) >= 0
    ? size as number
    : estimateStructuredCloneSize(record)
}

export function estimateStructuredCloneSize(
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

  if (isBlob(value)) {
    return value.size
  }

  if (isArrayBuffer(value)) {
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

export function addSizes(...values: number[]): number {
  let total = 0

  for (const value of values) {
    if (value >= Number.MAX_SAFE_INTEGER - total) {
      return Number.MAX_SAFE_INTEGER
    }

    total += value
  }

  return total
}

export function addCleanupSummary(
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

export function isQuotaExceededError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'QuotaExceededError'
  )
}
