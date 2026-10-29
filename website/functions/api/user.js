// Shared by the Worker router and its contract tests. No process-local counters.
export const user = {
  id: 1, name: 'Ada Lovelace', email: 'ada@example.com',
  role: 'developer', active: true,
  profile: { team: 'Npora', city: 'London' }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
  })
}

const methods = {
  user: 'GET', schema: 'GET', query: 'QUERY', sse: 'GET', ndjson: 'GET',
  retry: 'GET', timeout: 'GET', upload: 'POST', download: 'GET',
  auth: 'GET', refresh: 'POST', traffic: 'GET', 'traffic-probe': 'GET', health: 'GET'
}
const limit = 2 * 1024 * 1024

export async function handleApi(request, env) {
  const route = new URL(request.url).pathname.slice('/api/'.length)
  if (!Object.hasOwn(methods, route)) return json({ error: 'Not found' }, 404)
  if (request.method !== methods[route]) {
    return json({ error: `Use ${methods[route]}` }, 405, { allow: methods[route] })
  }
  if (['retry', 'auth', 'refresh', 'traffic', 'traffic-probe', 'health'].includes(route)) {
    if (!env.DEMO_STATE) return json({ error: 'Deploy the demo state Worker and bind DEMO_STATE first', code: 'DEMO_SETUP_REQUIRED' }, 503)
    const session = request.headers.get('x-demo-session') ?? ''
    if (route !== 'health' && !/^[a-zA-Z0-9-]{1,64}$/.test(session)) {
      return json({ error: 'A demo session identifier is required' }, 400)
    }
    // Traffic uses the trusted edge-supplied IP, independent of visitor headers.
    const key = route === 'health' ? 'health' : route === 'traffic'
      ? `traffic:${request.headers.get('cf-connecting-ip') ?? 'local'}`
      : `session:${session}`
    const stub = env.DEMO_STATE.get(env.DEMO_STATE.idFromName(key))
    try { return await stub.fetch(request) } catch {
      return json({ error: 'Demo state Worker is not reachable; check DEMO_STATE binding', code: 'DEMO_STATE_UNAVAILABLE' }, 503)
    }
  }
  try {
    switch (route) {
      case 'user': return json(user)
      case 'schema': return json({ ...user, id: 'abc', email: null })
      case 'query': {
        const bytes = await readBody(request)
        let filters
        try { filters = JSON.parse(new TextDecoder().decode(bytes)) } catch {
          return json({ error: 'Invalid JSON' }, 400)
        }
        if (!filters || Array.isArray(filters) || typeof filters !== 'object') {
          return json({ error: 'Expected a JSON object' }, 400)
        }
        return json({ method: 'QUERY', filters, users: [user], total: 1 })
      }
      case 'sse': return stream(3, 1000, 'text/event-stream', index =>
        `id: ${index}\nevent: update\ndata: ${JSON.stringify({ id: index, text: ['Hello, ', 'streaming ', 'world.'][index - 1] })}\n\n`)
      case 'ndjson': return stream(6, 250, 'application/x-ndjson', id =>
        `${JSON.stringify({ id, action: `record-${id}` })}\n`)
      case 'timeout':
        await delay(10000, request.signal)
        return json({ waited: 10000 })
      case 'upload': {
        // Bounded stream read before parsing multipart data: oversized chunked
        // requests must not evade the limit by omitting Content-Length.
        const bytes = await readBody(request)
        const form = await new Request(request.url, {
          method: 'POST', headers: { 'content-type': request.headers.get('content-type') ?? '' },
          body: bytes
        }).formData()
        const file = form.get('file')
        if (!file || typeof file === 'string') return json({ error: 'Expected file field' }, 400)
        return json({ name: file.name, bytes: file.size, receivedBytes: bytes.byteLength })
      }
      case 'download': return stream(16, 100, 'application/octet-stream', () =>
        new Uint8Array(64 * 1024).fill(110), { 'content-length': String(1024 * 1024),
          'content-disposition': 'attachment; filename="npora-demo.bin"' })
    }
  } catch (error) {
    if (error?.message === 'Body too large') return json({ error: 'Maximum body size is 2 MiB' }, 413)
    if (request.signal.aborted) return json({ error: 'Request cancelled' }, 408)
    return json({ error: 'Invalid request body' }, 400)
  }
}

export const onRequest = ({ request, env }) => handleApi(request, env)

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('Body too large')
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('Body too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function stream(count, interval, type, chunk, extraHeaders = {}) {
  let index = 0
  const abort = new AbortController()
  const encoder = new TextEncoder()
  let body = new ReadableStream({
    async pull(controller) {
      try {
        await delay(interval, abort.signal)
        if (abort.signal.aborted) return
        const value = chunk(++index)
        controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value)
        if (index === count) controller.close()
      } catch (error) {
        if (!abort.signal.aborted) controller.error(error)
      }
    },
    cancel() { abort.abort() }
  }, { highWaterMark: 0 })
  if (extraHeaders['content-length']) {
    // Workers derives Content-Length from the stream's intrinsic size; simply
    // setting the header on an arbitrary ReadableStream is not sufficient.
    const fixed = new FixedLengthStream(Number(extraHeaders['content-length']))
    void body.pipeTo(fixed.writable).catch(() => { /* client cancellation */ })
    body = fixed.readable
  }
  return new Response(body, {
    headers: { 'content-type': type, 'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff', ...extraHeaders }
  })
}

// SQLite-backed DO storage persists state across Worker/DO eviction. All
// read/modify/write operations run in a transaction to serialize concurrent calls.
export class DemoState {
  constructor(ctx) { this.ctx = ctx }

  async fetch(request) {
    const route = new URL(request.url).pathname.split('/').pop()
    if (route === 'health') return json({ ready: true, service: 'npora-request-demo-state' })
    // Allow simultaneous expired requests to reach the refresh single-flight.
    if (route === 'refresh') await delay(300, request.signal)
    return this.ctx.storage.transaction(async storage => {
      const now = Date.now()
      const state = await storage.get('state') ?? {}
      await storage.setAlarm(now + 15 * 60 * 1000)
      let response
      if (route === 'retry') {
        const run = new URL(request.url).searchParams.get('run') ?? 'default'
        if (!/^[a-zA-Z0-9-]{1,64}$/.test(run)) return json({ error: 'Invalid run identifier' }, 400)
        // One bounded counter per demo session, reset by a new run identifier.
        state.retry = state.retry?.run === run ? state.retry : { run, attempts: 0 }
        const attempt = ++state.retry.attempts
        response = json({ attempt, recovered: attempt >= 3 }, attempt < 3 ? 503 : 200)
      } else if (route === 'refresh') {
        state.token = crypto.randomUUID()
        response = json({ accessToken: state.token, tokenType: 'Bearer' })
      } else if (route === 'auth') {
        response = state.token && request.headers.get('authorization') === `Bearer ${state.token}`
          ? json({ ...user, authenticated: true })
          : json({ error: 'Demo access token expired' }, 401)
      } else if (route === 'traffic-probe') {
        // A separately labelled fault probe guarantees a Retry-After example
        // even when the visitor's network cannot deliver >5 requests/second.
        state.probeUntil ??= now + 5000
        response = now < state.probeUntil
          ? json({ error: 'Intentional 429 recovery probe', probe: true }, 429, { 'retry-after': '5' })
          : json({ accepted: true, probe: true })
      } else if (route === 'traffic') {
        state.hits = (state.hits ?? []).filter(time => now - time < 1000)
        if ((state.blockedUntil ?? 0) > now) {
          response = json({ error: 'Too many requests' }, 429, { 'retry-after': '5' })
        } else if (state.hits.length >= 5) {
          state.blockedUntil = now + 5000
          response = json({ error: 'Too many requests' }, 429, { 'retry-after': '5' })
        } else {
          state.hits.push(now)
          response = json({ accepted: true, remaining: 5 - state.hits.length })
        }
      } else return json({ error: 'Not found' }, 404)
      await storage.put('state', state)
      return response
    })
  }

  async alarm() { await this.ctx.storage.deleteAll() }
}
