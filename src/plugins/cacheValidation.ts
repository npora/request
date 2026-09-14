import { RequestError } from '../errors'
import type { RequestConfig } from '../types'

const MAX_CACHE_TAGS = 32
const MAX_CACHE_TAG_LENGTH = 128

export function normalizeCacheTtl(
  value: number | undefined,
  config: RequestConfig
): number {
  const ttl = value ?? 30000

  if (
    ttl !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(ttl) || ttl < 0)
  ) {
    throw new RequestError(
      'Cache ttl must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return ttl
}

export function normalizeCacheStatus(
  value: number | undefined,
  config: RequestConfig
): number {
  const status = value ?? 200

  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new RequestError(
      'Cache status must be an integer between 200 and 599',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return status
}

export function normalizeStaleIfError(
  value: number | undefined,
  config: RequestConfig
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    value !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(value) || value < 0)
  ) {
    throw new RequestError(
      'Cache staleIfError must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return value
}

export function normalizeStaleWhileRevalidate(
  value: number | undefined,
  config: RequestConfig
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    value !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(value) || value < 0)
  ) {
    throw new RequestError(
      'Cache staleWhileRevalidate must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return value
}

export function normalizeCacheTags(
  input: string | readonly string[] | undefined,
  config?: RequestConfig
): readonly string[] {
  if (input === undefined) {
    return []
  }

  if (typeof input !== 'string' && !Array.isArray(input)) {
    throw new RequestError('Cache tags must be an array of strings', {
      code: 'CONFIG_ERROR',
      config
    })
  }

  const values = typeof input === 'string' ? [input] : input

  if (values.length > MAX_CACHE_TAGS) {
    throw new RequestError(
      `Cache tags cannot contain more than ${MAX_CACHE_TAGS} values`,
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  const tags = new Set<string>()

  for (const tag of values) {
    if (
      typeof tag !== 'string' ||
      tag.length === 0 ||
      tag.length > MAX_CACHE_TAG_LENGTH
    ) {
      throw new RequestError(
        `Cache tags must contain 1 to ${MAX_CACHE_TAG_LENGTH} characters`,
        {
          code: 'CONFIG_ERROR',
          config
        }
      )
    }

    tags.add(tag)
  }

  return [...tags]
}

export function isExpired(expiresAt: number): boolean {
  return expiresAt !== Number.POSITIVE_INFINITY &&
    (Number.isNaN(expiresAt) || Date.now() >= expiresAt)
}
