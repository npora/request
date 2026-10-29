import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'

/** Exercise the installed package through native Fetch and actual HTTP sockets. */
export async function checkSessionContract({ createClient, isRequestError, authPlugin, cachePlugin, retryPlugin }, format) {
  const refreshReady = deferred()
  const interruptedRefresh = { received: deferred(), closed: deferred() }
  const pending = new Map(['view', 'logout'].map(key => [key, {
    received: deferred(), closed: deferred()
  }]))
  const reads = new Map()
  const items = new Map(['alice', 'bob', 'charlie'].map(account => [account, { id: 1, account, name: 'Notebook' }]))
  const failures = []
  let refreshes = 0
  let unauthorized = 0
  let failNextCatalogRead = true
  let rejectedWrites = 0
  let successfulWrites = 0
  const server = createServer((request, response) => {
    void serve(request, response).catch(error => {
      failures.push(error.message)
      response.destroy(error)
    })
  })

  async function serve(request, response) {
    const url = new URL(request.url, 'http://fixture.test')
    if (url.pathname === '/refresh') {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.authorization, undefined, 'refresh client must not recursively apply authentication')
      const input = await body(request)
      refreshes += 1
      if (input.account === 'charlie') {
        response.once('close', interruptedRefresh.closed.resolve)
        interruptedRefresh.received.resolve()
        return
      }
      assert.deepEqual(input, { account: 'alice' })
      await bounded(refreshReady.promise, 'both callers reaching refresh')
      json(response, { accessToken: 'alice:fresh' })
      return
    }

    const token = request.headers.authorization?.replace('Bearer ', '')
    const account = token?.split(':')[0]
    if (token !== `${account}:fresh` || !items.has(account)) {
      json(response, { message: 'Expired session' }, 401)
      return
    }
    if (url.pathname === '/pending') {
      const state = pending.get(url.searchParams.get('case'))
      assert.ok(state)
      response.once('close', state.closed.resolve)
      state.received.resolve()
      return
    }
    if (url.pathname === '/settings') {
      json(response, { account })
      return
    }
    assert.equal(url.pathname, '/catalog')
    if (request.method === 'POST') {
      const update = await body(request)
      if (!update.name) {
        rejectedWrites += 1
        json(response, { message: 'Name is required' }, 422)
      } else {
        successfulWrites += 1
        items.set(account, { ...items.get(account), name: update.name })
        json(response, items.get(account))
      }
      return
    }
    assert.equal(request.method, 'GET')
    reads.set(account, (reads.get(account) ?? 0) + 1)
    if (account === 'alice' && failNextCatalogRead) {
      failNextCatalogRead = false
      json(response, { message: 'Temporarily unavailable' }, 503)
    } else {
      json(response, [items.get(account)])
    }
  }

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseURL = `http://127.0.0.1:${server.address().port}`
  const sessions = []
  const readOptions = { extensions: { cache: { enabled: true, ttl: 60_000, tags: ['catalog'] } } }
  const writeOptions = name => ({ json: { name }, extensions: { cache: { invalidateTags: ['catalog'] } } })

  function session(account, initialToken) {
    let token = initialToken
    let closed = false
    const controller = new AbortController()
    const inFlight = new Set()
    const cache = cachePlugin({ maxEntries: 10 })
    const refreshApi = createClient({ baseURL, signal: controller.signal, timeout: 3000, totalTimeout: 10_000 })
    const api = refreshApi.extend().use(authPlugin({
      storage: { get: () => token, set: value => { token = value }, remove: () => { token = undefined } },
      shouldRefresh(error) {
        if (!isRequestError(error) || error.status !== 401) return false
        if (++unauthorized === 2) refreshReady.resolve()
        return true
      },
      async refreshToken() {
        const result = await refreshApi.post('/refresh', { json: { account } })
        return result.accessToken
      }
    })).use(retryPlugin({ retries: 2, delay: 0 })).use(cache)

    function request(path, config = {}) {
      if (closed) return Promise.reject(new Error('Session is closed'))
      const signal = config.signal
        ? AbortSignal.any([controller.signal, config.signal])
        : controller.signal
      const result = api.request({ url: path, ...config, signal })
      inFlight.add(result)
      void result.then(() => inFlight.delete(result), () => inFlight.delete(result))
      return result
    }
    const owner = {
      request,
      catalog: () => request('/catalog', readOptions),
      hasToken: () => token !== undefined,
      async logout() {
        if (closed) return
        closed = true
        controller.abort()
        await Promise.allSettled([...inFlight])
        try { await cache.clear() } finally {
          token = undefined
          api.unuse('cache').unuse('retry').unuse('auth')
        }
      }
    }
    sessions.push(owner)
    return owner
  }

  try {
    const alice = session('alice', 'alice:expired')
    const bob = session('bob', 'bob:fresh')
    assert.deepEqual(await Promise.all([alice.catalog(), alice.request('/settings')]), [
      [items.get('alice')], { account: 'alice' }
    ])
    assert.equal(unauthorized, 2)
    assert.equal(refreshes, 1, 'distinct URLs must share one refresh')
    assert.equal(reads.get('alice'), 2, 'one transient failure, then one successful authorized read')

    // Warm under the refreshed credential before asserting zero-network cache hits.
    const first = await alice.catalog()
    assert.deepEqual(await bob.catalog(), [items.get('bob')])
    const aliceReads = reads.get('alice')
    const bobReads = reads.get('bob')
    assert.deepEqual(await alice.catalog(), first)
    assert.deepEqual(await bob.catalog(), [items.get('bob')])
    assert.equal(reads.get('alice'), aliceReads)
    assert.equal(reads.get('bob'), bobReads)

    await assert.rejects(alice.request('/catalog', { method: 'POST', ...writeOptions('') }), error => {
      assert.ok(isRequestError(error))
      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.status, 422)
      assert.deepEqual(error.data, { message: 'Name is required' })
      return true
    })
    assert.equal(rejectedWrites, 1, 'rejected POST must not be retried')
    assert.deepEqual(await alice.catalog(), first)
    assert.equal(reads.get('alice'), aliceReads, 'failed writes must preserve cached reads')
    await alice.request('/catalog', { method: 'POST', ...writeOptions('Updated notebook') })
    assert.equal(successfulWrites, 1)
    assert.deepEqual(await alice.catalog(), [items.get('alice')])
    assert.equal(reads.get('alice'), aliceReads + 1, 'successful writes must invalidate the tag')

    for (const kind of ['view', 'logout']) {
      const view = new AbortController()
      const result = alice.request(`/pending?case=${kind}`, { signal: view.signal })
      const cancelled = assert.rejects(result, error => isRequestError(error) && error.code === 'ABORT_ERROR')
      await bounded(pending.get(kind).received.promise, `${kind} request reaching the server`)
      if (kind === 'view') view.abort()
      else await bounded(alice.logout(), 'logout settling outstanding work')
      await cancelled
      await bounded(pending.get(kind).closed.promise, `${kind} transport disconnect`)
      if (kind === 'view') {
        assert.equal(alice.hasToken(), true)
        assert.deepEqual(await alice.catalog(), [items.get('alice')])
      } else assert.equal(view.signal.aborted, false)
    }
    assert.equal(alice.hasToken(), false)
    await assert.rejects(alice.catalog(), /Session is closed/)

    const charlie = session('charlie', 'charlie:expired')
    const refreshing = charlie.catalog()
    const cancelledRefresh = assert.rejects(refreshing, error => isRequestError(error) && error.code === 'ABORT_ERROR')
    await bounded(interruptedRefresh.received.promise, 'refresh reaching the server')
    await bounded(charlie.logout(), 'logout during refresh')
    await cancelledRefresh
    await bounded(interruptedRefresh.closed.promise, 'refresh transport disconnect')
    assert.equal(charlie.hasToken(), false)
    assert.equal(refreshes, 2, 'one shared refresh and one interrupted refresh, without recursion')

    assert.equal(bob.hasToken(), true)
    assert.deepEqual(await bob.catalog(), [{ id: 1, account: 'bob', name: 'Notebook' }])
    assert.equal(reads.get('bob'), bobReads, 'logout and mutations must not affect another account')
    assert.deepEqual(failures, [])
    console.log(`${format}: installed HTTP session passed refresh sharing, retry, cache invalidation, cancellation and account isolation.`)
  } finally {
    refreshReady.resolve()
    const cleanup = Promise.allSettled(sessions.map(owner => owner.logout()))
    const closed = once(server, 'close')
    server.closeAllConnections()
    server.close()
    await bounded(Promise.all([cleanup, closed]), 'HTTP fixture cleanup')
  }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000)
    })])
  } finally { clearTimeout(timer) }
}

async function body(request) {
  assert.match(request.headers['content-type'] ?? '', /application\/json/)
  let text = ''
  for await (const chunk of request) text += chunk.toString()
  return JSON.parse(text)
}

function json(response, data, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(data))
}
