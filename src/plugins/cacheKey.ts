import type { CacheOptions, HttpMethod, QueryParams, RequestConfig } from '../types'
import { isURLSearchParams } from '../utils/isURLSearchParams'

const EMPTY_QUERY: ReadonlyArray<[string, string]> = []

export function createCacheKey(
  config: RequestConfig,
  cache: CacheOptions,
  varyHeaders: readonly string[],
  emptyHeaderValues: ReadonlyArray<[string, string | null]>,
  memo: CacheKeyMemo
): string {
  if (cache.key) {
    return cache.key
  }

  const method = config.method ?? 'GET'
  const url = String(config.url)
  const responseType = config.responseType ?? 'auto'
  const bare = !config.headers && !config.query && !config.searchParams

  if (
    bare &&
    memo.key !== undefined &&
    memo.method === method &&
    memo.baseURL === config.baseURL &&
    memo.url === url &&
    memo.responseType === responseType
  ) {
    return memo.key
  }

  const key = JSON.stringify({
    method,
    baseURL: config.baseURL,
    url,
    query: bare
      ? EMPTY_QUERY
      : normalizeQuery(config.searchParams ?? config.query),
    responseType,
    headers: config.headers
      ? normalizeCacheHeaders(
          new Headers(config.headers),
          varyHeaders
        )
      : emptyHeaderValues
  })

  if (bare) {
    memo.method = method
    memo.baseURL = config.baseURL
    memo.url = url
    memo.responseType = responseType
    memo.key = key
  }

  return key
}

export interface CacheKeyMemo {
  method?: HttpMethod
  baseURL?: string
  url?: string
  responseType?: string
  key?: string
}

export function normalizeCacheHeaders(
  headers: Headers | undefined,
  varyHeaders: readonly string[]
): Array<[string, string | null]> {
  const values: Array<[string, string | null]> = []

  headers?.forEach((value, name) => {
    if (!isRequestCacheControlHeader(name)) {
      values.push([name, value])
    }
  })

  for (const name of varyHeaders) {
    if (
      !isRequestCacheControlHeader(name) &&
      !headers?.has(name)
    ) {
      values.push([name, null])
    }
  }

  return values.sort(([first], [second]) => {
    return first.localeCompare(second)
  })
}

function isRequestCacheControlHeader(name: string): boolean {
  return name === 'cache-control' || name === 'pragma'
}

export function normalizeVaryHeaders(
  headers: readonly string[]
): readonly string[] {
  return [...new Set(headers.map(name => name.toLowerCase()))]
}

function normalizeQuery(
  query?: QueryParams | URLSearchParams
): ReadonlyArray<[string, string]> {
  if (!query) {
    return EMPTY_QUERY
  }

  if (isURLSearchParams(query)) {
    return [...query.entries()]
  }

  const entries: Array<[string, string]> = []

  for (const key of Object.keys(query).sort()) {
    appendQueryValue(entries, key, query[key])
  }

  return entries
}

function appendQueryValue(
  entries: Array<[string, string]>,
  key: string,
  value: QueryParams[string]
): void {
  if (value === undefined) {
    return
  }

  if (value === null) {
    entries.push([key, ''])
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(entries, key, item)
    }

    return
  }

  entries.push([key, String(value)])
}
