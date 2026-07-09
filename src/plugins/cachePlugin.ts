import type { RequestConfig } from '../types'
import type { Plugin } from './Plugin'

interface CacheRecord {
  data: unknown
  expiresAt: number
}

const cacheStore = new Map<string, CacheRecord>()

export function cachePlugin(): Plugin {
  return {
    name: 'cache',

    install(context) {
      context.hooks.onRequest(requestContext => {
        const cache = requestContext.config.cache

        if (!cache?.enabled) {
          return
        }

        const key = createCacheKey(requestContext.config)
        const record = cacheStore.get(key)

        if (!record) {
          return
        }

        if (Date.now() > record.expiresAt) {
          cacheStore.delete(key)
          return
        }

        requestContext.response = {
          data: record.data,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config: requestContext.config,
          raw: new Response()
        }
      })

      context.hooks.onResponse(requestContext => {
        const cache = requestContext.config.cache

        if (!cache?.enabled || !requestContext.response) {
          return
        }

        const key = createCacheKey(requestContext.config)
        const ttl = cache.ttl ?? 30000

        cacheStore.set(key, {
          data: requestContext.response.data,
          expiresAt: Date.now() + ttl
        })
      })
    }
  }
}

export function clearCache(): void {
  cacheStore.clear()
}

function createCacheKey(config: RequestConfig): string {
  if (config.cache?.key) {
    return config.cache.key
  }

  return JSON.stringify({
    method: config.method ?? 'GET',
    baseURL: config.baseURL,
    url: config.url,
    query: config.query
  })
}
