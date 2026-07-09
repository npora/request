import type { Client } from '../client'
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

    install(client: Client) {
      const originalRequest = client.request.bind(client)

      client.request = async function requestWithCache<T = unknown>(
        config: RequestConfig
      ): Promise<T> {
        if (!config.cache?.enabled) {
          return originalRequest<T>(config)
        }

        const key = createCacheKey(config)
        const record = cacheStore.get(key)

        if (record) {
          if (Date.now() <= record.expiresAt) {
            return record.data as T
          }

          cacheStore.delete(key)
        }

        const data = await originalRequest<T>(config)
        const ttl = config.cache.ttl ?? 30000

        cacheStore.set(key, {
          data,
          expiresAt: Date.now() + ttl
        })

        return data
      }
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
