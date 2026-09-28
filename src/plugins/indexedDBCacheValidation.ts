import { RequestError } from '../errors'
import type { IndexedDBCacheStoreOptions } from './indexedDBCacheTypes'

export function normalizeIndexedDBName(
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

export function normalizeIndexedDBMaxEntries(value?: number): number {
  if (value === undefined) {
    return 1000
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.POSITIVE_INFINITY : 0
  }

  return Math.max(0, Math.floor(value))
}

export function normalizeIndexedDBMaxBytes(value?: number): number {
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

export function normalizeQuotaRecovery(value?: boolean): boolean {
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

export function normalizeIndexedDBEventObserver(
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

export function normalizeIndexedDBAdmissionPolicy(
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

export function normalizeCompactionBoundary(value?: number): number {
  const boundary = value ?? Date.now()

  if (!Number.isFinite(boundary)) {
    throw new RequestError(
      'IndexedDB cache compact expiredBefore must be finite',
      { code: 'CONFIG_ERROR' }
    )
  }

  return boundary
}

export function normalizeCompactionMaxRemovals(value?: number): number {
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

export function normalizeIndexedDBSchemaVersion(value?: number): number {
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
