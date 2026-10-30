import { createClient } from '@npora/request/core'
import { authPlugin } from '@npora/request/plugins/auth'
import { cachePlugin } from '@npora/request/plugins/cache'

window.createBrowserSession = async (baseURL, account) => {
  const lifetime = new AbortController()
  const refreshApi = createClient({ baseURL, signal: lifetime.signal,
    fetchOptions: { credentials: 'include', cache: 'no-store' } })
  let token = (await refreshApi.post('/login', { query: { account }, json: {} })).accessToken
  let closed = false, candidates = 0
  const cache = cachePlugin()
  const auth = authPlugin({
    storage: { get: () => token, set: value => { token = value }, remove: () => { token = '' } },
    shouldRefresh(error) { if (error.status !== 401) return false; candidates++; return true },
    async refreshToken() { return (await refreshApi.post('/refresh', { json: {} })).accessToken }
  })
  const api = refreshApi.extend().use(auth).use(cache)
  const operations = new Map(), controllers = new Map()
  const capture = operation => operation.then(data => ({ ok: true, data }),
    error => ({ ok: false, code: error.code, status: error.status }))
  return {
    start(key, { cached = false, path = '/data' } = {}) {
      if (closed) throw new Error('Session closed')
      const controller = new AbortController()
      controllers.set(key, controller)
      operations.set(key, capture(api.get(path, {
        signal: AbortSignal.any([lifetime.signal, controller.signal]),
        extensions: { cache: { enabled: cached, ttl: 60000 } }
      })))
    },
    wait: key => operations.get(key),
    cancel: key => controllers.get(key).abort(),
    state: () => ({ token, closed, candidates }),
    expire() { token = `${account}:expired` },
    omitRefreshCookie: () => capture(refreshApi.post('/refresh', { json: {}, fetchOptions: { credentials: 'omit' } })),
    async logout() {
      closed = true; lifetime.abort()
      await Promise.all(operations.values())
      await cache.clear(); token = ''
      api.unuse(auth); api.unuse(cache)
    }
  }
}
