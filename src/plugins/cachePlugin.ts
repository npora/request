import type {
  CacheOptions,
  HttpMethod,
  QueryParams,
  RequestConfig
} from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

interface CacheRecord {
  data: unknown
  expiresAt: number
  status: number
  statusText: string
  headers: Headers
  raw?: Response
}

export interface CachePluginOptions {
  /**
   * HTTP methods that may be cached.
   *
   * @default GET and HEAD
   */
  methods?: readonly HttpMethod[]

  /**
   * Request headers included in the default cache key.
   *
   * @default authorization, cookie, accept and accept-language
   */
  varyHeaders?: readonly string[]
}

export interface CachePlugin extends Plugin {
  clear(): void
}

const DEFAULT_CACHE_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD'
]

const DEFAULT_VARY_HEADERS = [
  'authorization',
  'cookie',
  'accept',
  'accept-language'
] as const

export function cachePlugin(
  options: CachePluginOptions = {}
): CachePlugin {
  const cacheStore = new Map<string, CacheRecord>()
  const cacheHits = new WeakSet<object>()
  const methods = new Set(
    options.methods ?? DEFAULT_CACHE_METHODS
  )
  const varyHeaders =
    options.varyHeaders ?? DEFAULT_VARY_HEADERS

  const plugin: CachePlugin = {
    name: 'cache',

    clear() {
      cacheStore.clear()
    },

    install(context) {
      context.hooks.onRequest(requestContext => {
        const cache = resolveExtensionConfig(
          requestContext.config,
          'cache'
        )

        if (
          !cache?.enabled ||
          !isCacheableRequest(requestContext.config, methods)
        ) {
          return
        }

        const key = createCacheKey(
          requestContext.config,
          cache,
          varyHeaders
        )
        const record = cacheStore.get(key)

        if (!record) {
          return
        }

        if (Date.now() > record.expiresAt) {
          cacheStore.delete(key)
          return
        }

        requestContext.response = {
          data: cloneCacheValue(record.data),
          status: record.status,
          statusText: record.statusText,
          headers: new Headers(record.headers),
          config: requestContext.config,
          raw: cloneRawResponse(record)
        }
        cacheHits.add(requestContext)
      })

      context.hooks.onResponse(requestContext => {
        if (cacheHits.has(requestContext)) {
          return
        }

        const cache = resolveExtensionConfig(
          requestContext.config,
          'cache'
        )

        if (
          !cache?.enabled ||
          !requestContext.response ||
          !isCacheableRequest(requestContext.config, methods)
        ) {
          return
        }

        const key = createCacheKey(
          requestContext.config,
          cache,
          varyHeaders
        )
        const ttl = cache.ttl ?? 30000

        if (ttl <= 0) {
          cacheStore.delete(key)
          return
        }

        cacheStore.set(key, {
          data: cloneCacheValue(requestContext.response.data),
          expiresAt: Date.now() + ttl,
          status: requestContext.response.status,
          statusText: requestContext.response.statusText,
          headers: new Headers(requestContext.response.headers),
          raw: cloneResponse(requestContext.response.raw)
        })
      })
    }
  }

  return plugin
}

function isCacheableRequest(
  config: RequestConfig,
  methods: ReadonlySet<HttpMethod>
): boolean {
  return (
    methods.has(config.method ?? 'GET') &&
    config.responseType !== 'stream'
  )
}

function createCacheKey(
  config: RequestConfig,
  cache: CacheOptions,
  varyHeaders: readonly string[]
): string {
  if (cache.key) {
    return cache.key
  }

  const headers = new Headers(config.headers)

  return JSON.stringify({
    method: config.method ?? 'GET',
    baseURL: config.baseURL,
    url: config.url,
    query: normalizeQuery(config.query),
    responseType: config.responseType ?? 'auto',
    headers: Object.fromEntries(
      varyHeaders.map(name => [
        name.toLowerCase(),
        headers.get(name)
      ])
    )
  })
}

function normalizeQuery(
  query?: QueryParams
): Array<[string, string]> {
  if (!query) {
    return []
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
  if (value === null || value === undefined) {
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

function cloneRawResponse(record: CacheRecord): Response {
  if (record.raw) {
    const cloned = cloneResponse(record.raw)

    if (cloned) {
      return cloned
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

function cloneCacheValue<T>(value: T): T {
  if (typeof structuredClone !== 'function') {
    return value
  }

  try {
    return structuredClone(value)
  } catch {
    return value
  }
}
