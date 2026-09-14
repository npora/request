import { createClient } from '@npora/request/core'
import { cachePlugin } from '@npora/request/plugins/cache'
import { retryPlugin } from '@npora/request/plugins/retry'

const cache = cachePlugin()
const api = createClient({
  baseURL: '/api',
  extensions: { cache: { enabled: true } }
}).use(cache).use(retryPlugin({ retries: 1, delay: 0 }))

window.consumerApp = {
  load(key) {
    return api.get(`/count?key=${encodeURIComponent(key)}&cache=enabled`, {
      fetchOptions: { cache: 'no-store' }
    })
  },
  clear() {
    return cache.clear()
  },
  fail() {
    return api.get('/error')
  },
  abort() {
    const controller = new AbortController()
    const pending = api.get('/slow', { signal: controller.signal })
    controller.abort()
    return pending
  }
}
