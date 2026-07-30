import type {
  CacheOptions,
  HttpMethod,
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

let cacheGeneration = 0

export function cachePlugin(
  options: CachePluginOptions = {}
): CachePlugin {
  const cacheStore = new Map<string, CacheRecord>()
  const methods = new Set(
    options.methods ?? DEFAULT_CACHE_METHODS
  )
  const varyHeaders =
    options.varyHeaders ?? DEFAULT_VARY_HEADERS
  let localGeneration = cacheGeneration

  const plugin: CachePlugin = {
    name: 'cache',

    clear() {
      cacheStore.clear()
      localGeneration = cacheGeneration
    },

    install(context) {
      context.hooks.onRequest(requestContext => {
        syncGeneration()

        const cache = resolveExtensionConfig(
          requestContext.config,
          'cache',
          requestContext.config.cache
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
      })

      context.hooks.onResponse(requestContext => {
        syncGeneration()

        const cache = resolveExtensionConfig(
          requestContext.config,
          'cache',
          requestContext.config.cache
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

  function syncGeneration(): void {
    if (localGeneration === cacheGeneration) {
      return
    }

    cacheStore.clear()
    localGeneration = cacheGeneration
  }
}

export function clearCache(): void {
  cacheGeneration += 1
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
    query: config.query,
    headers: Object.fromEntries(
      varyHeaders.map(name => [
        name.toLowerCase(),
        headers.get(name)
      ])
    )
  })
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
