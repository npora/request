import { describe, expect, it } from 'vitest'
import { RequestError } from '../src/errors'
import { IndexedDBCacheStore } from '../src/plugins/indexedDBCacheStore'
import {
  addCleanupSummary, addSizes, classifyIndexedDBRecord,
  estimateStructuredCloneSize, isFutureIndexedDBRecord,
  isQuotaExceededError, isValidIndexedDBRecord,
  readIndexedDBRecordSize, readIndexedDBSchemaVersion, toPortableCacheEntry
} from '../src/plugins/indexedDBCacheRecords'
import {
  normalizeCompactionBoundary, normalizeCompactionMaxRemovals
} from '../src/plugins/indexedDBCacheValidation'
import type {
  IndexedDBCacheRecord, IndexedDBCleanupSummary, IndexedDBCacheStoreEvent
} from '../src/plugins/indexedDBCacheTypes'

const record = (): IndexedDBCacheRecord => ({
  key: 'session\0profile',
  namespace: 'session',
  data: { id: 1 },
  expiresAt: Number.POSITIVE_INFINITY,
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  tags: ['profile'],
  accessedAt: 1,
  schemaVersion: 1
})

describe('IndexedDB record boundaries', () => {
  it('accepts legacy schema records and confines reads to their namespace and key', () => {
    const legacy = record()
    delete legacy.schemaVersion
    expect(readIndexedDBSchemaVersion(legacy)).toBe(1)
    expect(isValidIndexedDBRecord(legacy, 'session', legacy.key)).toBe(true)
    expect(isValidIndexedDBRecord(legacy, 'other')).toBe(false)
    expect(isValidIndexedDBRecord(legacy, 'session', 'other')).toBe(false)
    expect(classifyIndexedDBRecord(legacy, 'session', 2)).toBe('schema-version')
  })

  it('preserves future schema records even when the older reader cannot interpret them', () => {
    const future = { schemaVersion: 2, data: 'new representation' }
    expect(classifyIndexedDBRecord(future, 'session', 1)).toBe('future')
    expect(isFutureIndexedDBRecord(future, 1)).toBe(true)
    expect(isValidIndexedDBRecord(future, 'session')).toBe(false)
    expect(classifyIndexedDBRecord(record(), 'session', 1)).toBe('current')
    expect(isFutureIndexedDBRecord(record(), 1)).toBe(false)
  })

  it.each([undefined, null, 0, { schemaVersion: 0 }, { schemaVersion: 1.5 },
    { schemaVersion: 1_000_000_001 }, { schemaVersion: '1' }])(
    'rejects invalid stored schema metadata: %j', value => {
      expect(readIndexedDBSchemaVersion(value)).toBeUndefined()
      expect(classifyIndexedDBRecord(value, 'session', 1)).toBe('malformed')
    }
  )

  it.each([
    { status: 199 }, { status: 600 }, { expiresAt: Number.NaN },
    { accessedAt: Number.NaN }, { headers: [['invalid\nheader', 'value']] },
    { tags: [''] }, { tags: ['x'.repeat(129)] }, { tags: Array(33).fill('tag') }
  ])('rejects malformed records before exposing cached values: %j', fields => {
    const invalid = { ...record(), ...fields }
    expect(isValidIndexedDBRecord(invalid, 'session')).toBe(false)
    expect(classifyIndexedDBRecord(invalid, 'session', 1)).toBe('malformed')
  })

  it('removes persistence metadata from returned entries', () => {
    const stored = { ...record(), size: 128 }
    expect(toPortableCacheEntry(stored)).toEqual({
      data: { id: 1 }, expiresAt: Infinity, status: 200, statusText: 'OK',
      headers: [['content-type', 'application/json']], tags: ['profile']
    })
  })
})

describe('IndexedDB byte accounting', () => {
  it('counts binary payloads without serializing or consuming them', () => {
    const buffer = new ArrayBuffer(1024)
    const bytes = new Uint8Array(buffer, 16, 64)
    expect(estimateStructuredCloneSize(buffer)).toBe(1024)
    expect(estimateStructuredCloneSize(bytes)).toBe(64)
    expect(estimateStructuredCloneSize(new Blob([buffer]))).toBe(1024)
    expect(bytes.byteLength).toBe(64)
  })

  it('handles cyclic and shared collections with finite accounting', () => {
    const graph: { self?: unknown; map?: Map<unknown, unknown>; set?: Set<unknown> } = {}
    graph.self = graph
    graph.map = new Map([[graph, new Set([graph, undefined, null, true, 1n])]])
    graph.set = new Set([graph, new Date(0), 'text', 1, () => {}])
    const size = estimateStructuredCloneSize(graph)
    expect(Number.isSafeInteger(size)).toBe(true)
    expect(size).toBeGreaterThan(0)
  })

  it('falls back to estimation for invalid or legacy size metadata', () => {
    expect(readIndexedDBRecordSize(record())).toBeGreaterThan(0)
    for (const size of [-1, Infinity, NaN, 1.5, '128']) {
      const stored = { ...record(), size }
      expect(readIndexedDBRecordSize(stored)).toBe(estimateStructuredCloneSize(stored))
    }
    expect(readIndexedDBRecordSize({ size: 128 })).toBe(128)
    expect(readIndexedDBRecordSize(null)).toBe(0)
  })

  it('saturates byte totals without integer overflow and groups cleanup by reason', () => {
    const summaries = new Map<IndexedDBCacheStoreEvent['reason'], IndexedDBCleanupSummary>()
    addCleanupSummary(summaries, 'expired', { size: Number.MAX_SAFE_INTEGER })
    addCleanupSummary(summaries, 'expired', { size: 100 })
    addCleanupSummary(summaries, 'malformed', { size: 2 })
    expect(summaries.get('expired')).toEqual({
      reason: 'expired', entries: 2, estimatedBytes: Number.MAX_SAFE_INTEGER
    })
    expect(summaries.get('malformed')?.entries).toBe(1)
    expect(addSizes(Number.MAX_SAFE_INTEGER - 1, 100)).toBe(Number.MAX_SAFE_INTEGER)
    expect(addSizes(1, 2)).toBe(3)
  })

  it('recognizes quota errors without requiring DOMException identity', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true)
    expect(isQuotaExceededError(new Error('QuotaExceededError'))).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
  })
})

describe('IndexedDB option validation', () => {
  const factory = {} as IDBFactory

  it('validates persistence configuration before attempting to open a database', () => {
    const invalid = [
      { namespace: '' }, { databaseName: 'x'.repeat(129) },
      { maxBytes: -1 }, { maxBytes: 0.5 }, { quotaRecovery: 'yes' },
      { onEvent: true }, { shouldPersist: true }
    ]
    for (const options of invalid) {
      expect(() => new IndexedDBCacheStore(factory, options as never))
        .toThrow(RequestError)
    }
    expect(() => new IndexedDBCacheStore(factory)).not.toThrow()
    expect(() => new IndexedDBCacheStore(factory, {
      maxEntries: Infinity, maxBytes: Infinity, quotaRecovery: false,
      onEvent() {}, shouldPersist: () => true
    })).not.toThrow()
    expect(() => new IndexedDBCacheStore(factory, { maxEntries: -1 })).not.toThrow()
    expect(() => new IndexedDBCacheStore(factory, { maxEntries: 1.5, maxBytes: 0 })).not.toThrow()
  })

  it('keeps compaction bounded and rejects invalid maintenance options', () => {
    expect(normalizeCompactionBoundary(0)).toBe(0)
    expect(Number.isFinite(normalizeCompactionBoundary())).toBe(true)
    expect(normalizeCompactionMaxRemovals()).toBe(Infinity)
    expect(normalizeCompactionMaxRemovals(Infinity)).toBe(Infinity)
    expect(normalizeCompactionMaxRemovals(1)).toBe(1)
    for (const boundary of [NaN, Infinity, -Infinity]) {
      expect(() => normalizeCompactionBoundary(boundary)).toThrow(RequestError)
    }
    for (const count of [0, -1, 0.5, NaN, -Infinity]) {
      expect(() => normalizeCompactionMaxRemovals(count)).toThrow(RequestError)
    }
  })
})
