import { createServer } from 'node:http'
import { once } from 'node:events'

// Different ports produce different origins while keeping cookies same-site.
export async function createSessionServer() {
  const accounts = new Map()
  const failures = [], preflights = []
  const stats = account => {
    if (!accounts.has(account)) accounts.set(account, {
      reads: 0, unauthorized: 0, refreshes: 0, refreshClosed: 0, pending: 0, pendingClosed: 0, held: []
    })
    return accounts.get(account)
  }
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.test')
    const account = /(?:^|;\s*)npora-session=(alice|bob)(?:;|$)/.exec(request.headers.cookie ?? '')?.[1]
    const origin = request.headers.origin
    const headers = {
      'access-control-allow-origin': 'http://localhost:4173',
      'access-control-allow-credentials': 'true',
      'cache-control': 'no-store', vary: 'Origin'
    }
    const json = (value, status = 200, extra = {}) => {
      response.writeHead(status, { ...headers, 'content-type': 'application/json', ...extra })
      response.end(JSON.stringify(value))
    }
    if (origin !== 'http://localhost:4173') {
      failures.push(`Unexpected origin: ${origin}`)
      json({ error: 'Unexpected origin' }, 403)
      return
    }
    if (request.method === 'OPTIONS') {
      // Preflights intentionally have no cookies. Verify the requested headers.
      preflights.push({ method: request.headers['access-control-request-method'],
        headers: request.headers['access-control-request-headers'], cookie: request.headers.cookie })
      if (!request.headers['access-control-request-method']) failures.push('Missing preflight method')
      response.writeHead(204, { ...headers,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '0'
      })
      response.end()
      return
    }
    if (url.pathname === '/login') {
      const name = url.searchParams.get('account')
      if (!['alice', 'bob'].includes(name)) { json({ error: 'Unknown account' }, 400); return }
      stats(name)
      json({ accessToken: `${name}:expired` }, 200, {
        'set-cookie': `npora-session=${name}; Path=/; HttpOnly; SameSite=Lax`
      })
      return
    }
    if (!account) { json({ error: 'Refresh cookie required' }, 401); return }
    const state = stats(account)
    if (url.pathname === '/refresh') {
      if (request.headers.authorization) failures.push('Refresh carried an authorization header')
      state.refreshes++
      state.held.push(() => { if (!response.destroyed) json({ accessToken: `${account}:fresh` }) })
      response.once('close', () => { if (!response.writableEnded) state.refreshClosed++ })
      return
    }
    if (request.headers.authorization !== `Bearer ${account}:fresh`) {
      state.unauthorized++
      json({ error: 'Expired access token' }, 401)
      return
    }
    if (url.pathname === '/pending') {
      state.pending++
      response.once('close', () => { if (!response.writableEnded) state.pendingClosed++ })
      return
    }
    if (url.pathname === '/denied') {
      json({ account }, 200, { 'access-control-allow-origin': 'https://not-allowed.test' })
      return
    }
    if (url.pathname !== '/data') { json({ error: 'Not found' }, 404); return }
    state.reads++
    json({ account, read: state.reads }, 200, {
      'cache-control': 'private, max-age=60', vary: 'Origin, Cookie',
      'access-control-expose-headers': 'Vary'
    })
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  return {
    origin: `http://localhost:${server.address().port}`, stats, failures, preflights,
    release(account) { for (const release of stats(account).held.splice(0)) release() },
    async close() {
      for (const state of accounts.values()) for (const release of state.held.splice(0)) release()
      const closed = once(server, 'close')
      server.close(); server.closeAllConnections()
      await closed
    }
  }
}
