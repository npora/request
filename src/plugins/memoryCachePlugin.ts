import { RequestError } from '../errors'
import type {
  MemoryCacheOptions,
  NporaResponse,
  QueryParams,
  RequestConfig
} from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import type { CacheEntry } from './cacheStores'

const METHODS = new Set(['GET', 'HEAD'] as const)

export interface MemoryCachePluginOptions {
  /** Default lifetime in milliseconds. @default 30000 */
  ttl?: number

  /** Maximum number of entries retained by this plugin. @default 100 */
  maxEntries?: number
}

export interface MemoryCachePlugin extends Plugin {
  clear(): void
}

/**
 * Opt-in memory-only TTL caching for data and complete-response requests.
 * HTTP revalidation, stale serving, shared misses, persistence, and tags
 * remain exclusive to cachePlugin().
 */
export function memoryCachePlugin(
  options: MemoryCachePluginOptions = {}
): MemoryCachePlugin {
  const maxEntries = options.maxEntries ?? 100

  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RequestError('Memory cache maxEntries must be a positive integer', {
      code: 'CONFIG_ERROR'
    })
  }

  const entries = new Map<string, CacheEntry>()
  const hits = new WeakSet<object>()

  return {
    name: 'memory-cache',
    conflicts: ['cache'],

    clear() {
      entries.clear()
    },

    install(context) {
      context.hooks.onTransport(requestContext => {
        const config = requestContext.config
        const cache = resolveExtensionConfig(config, 'memoryCache')

        if (!cache?.enabled || requestContext.response ||
          !cacheableRequest(config, cache)) return

        cacheTtl(cache.ttl ?? options.ttl, config)

        if (!requestAllowsCache(config)) return

        const key = cacheKey(config, cache)
        const entry = entries.get(key)

        if (!entry) return
        if (Date.now() >= entry.expiresAt) {
          entries.delete(key)
          return
        }

        const restored = restoreEntry(entry, config, requestContext.preserveRaw)

        if (!restored) {
          entries.delete(key)
          return
        }

        entries.delete(key)
        entries.set(key, entry)
        hits.add(requestContext)
        requestContext.response = restored
        requestContext.cacheHit = true
      })

      context.hooks.onResponse(requestContext => {
        if (hits.delete(requestContext)) return

        const config = requestContext.config
        const cache = resolveExtensionConfig(config, 'memoryCache')
        const response = requestContext.response

        if (!cache?.enabled || !response ||
          !cacheableRequest(config, cache) ||
          !requestAllowsCache(config) ||
          response.status < 200 || response.status >= 300 ||
          response.status === 206 ||
          response.raw.type === 'opaque' ||
          response.raw.type === 'opaqueredirect' ||
          isAsyncIterable(response.data)) return

        const ttl = cacheTtl(cache.ttl ?? options.ttl, config)
        const responseTtl = cacheResponseTtl(response, ttl)

        if (responseTtl <= 0) return

        const key = cacheKey(config, cache)
        const entry = snapshotResponse(
          response,
          Date.now() + responseTtl,
          requestContext.preserveRaw
        )

        if (!entry) return

        entries.delete(key)
        entries.set(key, entry)

        if (entries.size > maxEntries) {
          entries.delete(entries.keys().next().value!)
        }
      }, { requiresRawResponse: false })
    }
  }
}

function cacheableRequest(
  config: RequestConfig,
  cache: MemoryCacheOptions
): boolean {
  return METHODS.has((config.method ?? 'GET') as 'GET' | 'HEAD') &&
    config.body == null && config.json === undefined &&
    config.form == null && config.formData == null &&
    (!config.parseJson || Boolean(cache.key)) &&
    (!config.querySerializer || Boolean(cache.key)) &&
    config.responseType !== 'stream' &&
    config.responseType !== 'sse' &&
    config.responseType !== 'ndjson' &&
    config.responseType !== 'bytes' &&
    config.responseType !== 'formData' &&
    config.fetchOptions?.cache === undefined &&
    config.fetchOptions?.integrity === undefined &&
    config.fetchOptions?.referrer === undefined &&
    config.fetchOptions?.referrerPolicy === undefined &&
    config.fetchOptions?.mode === undefined &&
    (config.fetchOptions?.redirect === undefined ||
      config.fetchOptions.redirect === 'follow') &&
    (config.fetchOptions?.credentials === 'omit' || Boolean(cache.key))
}

function cacheTtl(value: number | undefined, config: RequestConfig): number {
  const ttl = value ?? 30_000

  if (ttl !== Infinity && (!Number.isFinite(ttl) || ttl < 0)) {
    throw new RequestError('Memory cache ttl must be non-negative', {
      code: 'CONFIG_ERROR', config
    })
  }

  return ttl
}

function requestAllowsCache(config: RequestConfig): boolean {
  const headers = new Headers(config.headers)

  // Explicit HTTP cache directives remain under the transport's control.
  return !headers.has('cache-control') && !headers.has('pragma')
}

function cacheResponseTtl(response: NporaResponse, configured: number): number {
  if (response.headers.has('vary')) return 0

  const control = response.headers.get('cache-control')
  let maxAge: number | undefined

  if (control) {
    for (const part of control.split(',')) {
      const directive = part.trim().toLowerCase()

      const name = directive.split('=', 1)[0]
      if (name === 'no-store' || name === 'no-cache') return 0
      if (!directive.startsWith('max-age=')) continue
      if (maxAge !== undefined || !/^max-age=\d+$/.test(directive)) return 0
      maxAge = Number(directive.slice(8))
      if (!Number.isSafeInteger(maxAge)) return 0
    }
  }

  if (maxAge === undefined) return configured

  const age = response.headers.get('age')
  const parsedAge = age && /^\d+$/.test(age) ? Number(age) : 0

  return Math.min(configured, Math.max(0, maxAge - parsedAge) * 1000)
}

function cacheKey(config: RequestConfig, cache: MemoryCacheOptions): string {
  if (cache.key) return cache.key

  const headers = new Headers(config.headers)
  const selected: Array<[string, string]> = []

  headers.forEach((value, name) => {
    if (name !== 'cache-control' && name !== 'pragma') {
      selected.push([name, value])
    }
  })
  selected.sort(([first], [second]) => first.localeCompare(second))

  const query: Array<[string, string]> = []

  if (config.searchParams) {
    query.push(...config.searchParams.entries())
  } else if (config.query) {
    for (const name of Object.keys(config.query).sort()) {
      appendQuery(query, name, config.query[name])
    }
  }

  return JSON.stringify({
    method: config.method ?? 'GET',
    baseURL: config.baseURL,
    url: String(config.url),
    responseType: config.responseType ?? 'auto',
    query,
    headers: selected
  })
}

function appendQuery(
  output: Array<[string, string]>,
  name: string,
  value: QueryParams[string]
): void {
  if (value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(output, name, item)
    return
  }

  output.push([name, value === null ? '' : String(value)])
}

function snapshotResponse(
  response: NporaResponse,
  expiresAt: number,
  preserveRaw: boolean
): CacheEntry | undefined {
  const data = cloneData(response.data)
  if (!data) return undefined
  const raw = preserveRaw ? tryClone(response.raw) : undefined
  if (preserveRaw && !raw) return undefined

  return {
    data: data.value,
    expiresAt,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    raw
  }
}

function restoreEntry(
  entry: CacheEntry,
  config: RequestConfig,
  preserveRaw: boolean
): NporaResponse | undefined {
  try {
    if (preserveRaw && !entry.raw) return undefined
    const data = cloneData(entry.data)
    if (!data) return undefined
    const cloned = entry.raw && tryClone(entry.raw)
    if (preserveRaw && !cloned) return undefined
    const raw = new Response(cloned?.body ?? null, {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers
    })

    return {
      data: data.value,
      status: entry.status,
      statusText: entry.statusText,
      headers: new Headers(entry.headers),
      config,
      raw
    }
  } catch {
    return undefined
  }
}

function tryClone(response: Response): Response | undefined {
  try {
    return response.clone()
  } catch {
    return undefined
  }
}

function cloneData<T>(value: T): { value: T } | undefined {
  if (value === null || typeof value !== 'object') return { value }
  if (typeof structuredClone !== 'function') return undefined
  try {
    return { value: structuredClone(value) }
  } catch {
    return undefined
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null &&
    Symbol.asyncIterator in value
}
