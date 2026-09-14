import type { NporaResponse, RequestConfig } from '../types'
import type { CacheEntry } from './cacheStores'

export function createCacheEntry(
  response: NporaResponse,
  expiresAt: number,
  preserveRaw: boolean,
  tags?: readonly string[]
): CacheEntry {
  return {
    data: cloneCacheValue(response.data),
    expiresAt,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    tags: tags ? [...tags] : undefined,
    raw: preserveRaw
      ? cloneResponse(response.raw)
      : undefined
  }
}

export function createCachedResponse(
  record: CacheEntry,
  config: RequestConfig
): NporaResponse {
  return {
    data: cloneCacheValue(record.data),
    status: record.status,
    statusText: record.statusText,
    headers: new Headers(record.headers),
    config,
    raw: cloneRawResponse(record)
  }
}

export function restoreCacheEntry(
  record: CacheEntry,
  config: RequestConfig
): NporaResponse | undefined {
  try {
    return createCachedResponse(record, config)
  } catch {
    return undefined
  }
}

export function createRevalidatedResponse(
  record: CacheEntry,
  response: NporaResponse,
  config: RequestConfig
): NporaResponse {
  const headers = new Headers(record.headers)

  response.headers.forEach((value, name) => {
    headers.set(name, value)
  })

  return createCachedResponse({
    ...record,
    headers: [...headers.entries()]
  }, config)
}

function cloneRawResponse(record: CacheEntry): Response {
  if (record.raw) {
    const cloned = cloneResponse(record.raw)

    if (cloned) {
      return new Response(cloned.body, {
        status: record.status,
        statusText: record.statusText,
        headers: record.headers
      })
    }
  }

  return new Response(null, {
    status: record.status,
    statusText: record.statusText,
    headers: record.headers
  })
}

function cloneResponse(response: Response): Response | undefined {
  try {
    return response.clone()
  } catch {
    return undefined
  }
}

export function cloneCacheValue<T>(value: T): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof structuredClone !== 'function'
  ) {
    return value
  }

  try {
    return structuredClone(value)
  } catch {
    return value
  }
}
