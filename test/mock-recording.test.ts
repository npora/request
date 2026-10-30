import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createClient, FetchAdapter, MockAdapter, RequestError } from '../src'
import type { Adapter, NporaResponse, RequestConfig, MockRecording } from '../src'

const response = (config: RequestConfig, data: unknown, status = 200): NporaResponse => ({
  data, status, statusText: status === 200 ? 'OK' : 'Failure', headers: new Headers(), config
})
const adapter = (data: unknown): Adapter => ({
  async request<T>(config: RequestConfig) { return response(config, data) as NporaResponse<T> }
})
const replay = (source: string) => {
  const mock = new MockAdapter()
  // Generated scripts must execute without interpolation or prototype side effects.
  new Function('mock', source)(mock)
  return mock
}

describe('MockAdapter recording', () => {
  it('forwards unmatched requests and replays real HTTP replies and HTTP errors', async () => {
    const mock = new MockAdapter({ record: { adapter: new FetchAdapter() } })
    mock.onGet('/local').reply(200, { local: true })
    const api = createClient({ baseURL: origin, adapter: mock })
    expect(await api.get('/local')).toEqual({ local: true })
    expect(await api.get('/user')).toEqual({ id: 1, name: 'Npora' })
    await expect(api.get('/failure')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 422 })
    expect(mock.recordingStats).toEqual({ recorded: 2, skipped: 0 })
    const records = mock.recordings
    expect(records.map(value => value.response.status)).toEqual([200, 422])
    expect(records[0]!.response.headers['x-fixture']).toBe('real-http')
    const offline = createClient({ adapter: replay(mock.exportMocks()) })
    expect(await offline.get('/user')).toEqual({ id: 1, name: 'Npora' })
    await expect(offline.get('/failure')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 422, data: { error: 'Invalid' } })
    await expect(offline.get('/user')).rejects.toThrow('No mock handler')
  })

  it('snapshots data and matchers, redacts credentials, and exports safe JavaScript', async () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"password":"secret","nested":{"access_token":"token"},"text":"\\\";globalThis.bad=true;//</script>"}')
    const source: Adapter = {
      async request<T>(config: RequestConfig) {
        return { ...response(config, payload), headers: new Headers({ 'set-cookie': 'session=secret', authorization: 'secret', 'x-api-key': 'secret', 'x-public': 'yes' }) } as NporaResponse<T>
      }
    }
    const mock = new MockAdapter({ record: { adapter: source } })
    const config = { url: '/user', method: 'QUERY' as const, query: { role: ['a', 'b'] }, headers: { authorization: 'request-secret' } }
    const actual = await mock.request(config)
    expect(actual.data).toBe(payload)
    expect(payload.password).toBe('secret')
    payload.nested.access_token = 'changed'; config.query.role.push('c')
    const record = mock.recordings[0]!
    expect(record.matcher.query).toEqual({ role: ['a', 'b'] })
    expect(record.response.headers).toEqual({ 'x-public': 'yes' })
    expect(record.response.data).toMatchObject({ password: '[REDACTED]', nested: { access_token: '[REDACTED]' } })
    record.response.headers['x-public'] = 'mutated'
    expect(mock.recordings[0]!.response.headers['x-public']).toBe('yes')
    const script = mock.exportMocks()
    expect(script).not.toContain('request-secret'); expect(script).not.toContain('</script>')
    const restored = await replay(script).request<Record<string, unknown>>({ url: '/user', method: 'QUERY', query: { role: ['a', 'b'] } })
    expect(Object.hasOwn(restored.data, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((globalThis as Record<string, unknown>).bad).toBeUndefined()
  })

  it('preserves request invocation order despite concurrent completions and bounds retention', async () => {
    const releases: Array<(value: NporaResponse) => void> = []
    const source: Adapter = { request: vi.fn(() => new Promise(resolve => releases.push(resolve))) as Adapter['request'] }
    const mock = new MockAdapter({ record: { adapter: source, maxEntries: 2 } })
    const configs = [1, 2, 3].map(id => ({ url: '/same', context: { id } }))
    const requests = configs.map(config => mock.request(config))
    releases[2]!(response(configs[2]!, 3)); releases[1]!(response(configs[1]!, 2)); releases[0]!(response(configs[0]!, 1))
    await Promise.all(requests)
    expect(mock.recordings.map(value => value.response.data)).toEqual([2, 3])
    const restored = replay(mock.exportMocks())
    expect((await restored.request({ url: '/same' })).data).toBe(2)
    expect((await restored.request({ url: '/same' })).data).toBe(3)
  })

  it('does not consume streams, invoke getters, or record unsupported or oversized data', async () => {
    const getter = vi.fn(() => 'hidden')
    const pull = vi.fn()
    const stream = new ReadableStream({ pull }, { highWaterMark: 0 })
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    const values = [stream, new Blob(['bytes']), cyclic, { get value() { return getter() } }, { n: 1n }, 'x'.repeat(2000), new Date()]
    for (const value of values) {
      const mock = new MockAdapter({ record: { adapter: adapter(value), maxRecordSize: 1024 } })
      expect((await mock.request({ url: '/data' })).data).toBe(value)
      expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 1 })
    }
    expect(pull).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled()
    await stream.cancel()
  })

  it('skips sensitive URL and query matchers while forwarding the original request', async () => {
    for (const config of [
      { url: 'https://user:password@example.test/user' },
      { url: '/user?access_token=secret' },
      { url: '/user#access_token=secret' },
      { url: '/user', query: { api_key: 'secret' } },
      { url: '/user', searchParams: new URLSearchParams('token=secret') }
    ]) {
      const mock = new MockAdapter({ record: { adapter: adapter({ ok: true }) } })
      expect((await mock.request(config)).data).toEqual({ ok: true })
      expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 1 })
    }
  })

  it('supports duplicate search params, bodyless responses, filters and custom redaction', async () => {
    const mock = new MockAdapter({ record: {
      adapter: adapter({ email: 'private@example.test' }),
      transform(recording) {
        if (recording.matcher.url === '/skip') return undefined
        recording.response.data = { email: '[REMOVED]' }
        return recording
      }
    } })
    await mock.request({ url: '/data', searchParams: new URLSearchParams('tag=a&tag=b') })
    await mock.request({ url: '/skip' })
    const restored = replay(mock.exportMocks())
    expect((await restored.request({ url: '/data', searchParams: new URLSearchParams('tag=a&tag=b') })).data).toEqual({ email: '[REMOVED]' })
    expect(mock.recordingStats).toEqual({ recorded: 1, skipped: 1 })
    const bodyless = new MockAdapter({ record: { adapter: adapter(undefined) } })
    await bodyless.request({ url: '/head', method: 'HEAD' })
    expect((await replay(bodyless.exportMocks()).request({ url: '/head', method: 'HEAD' })).data).toBeUndefined()
  })

  it('never replaces transport results when transformations fail or return malformed output', async () => {
    for (const transform of [() => { throw new Error('redactor failed') }, () => ({} as never), async () => undefined, async () => { throw new Error('async redactor') }]) {
      const mock = new MockAdapter({ record: { adapter: adapter('actual'), transform: transform as never } })
      expect((await mock.request({ url: '/data' })).data).toBe('actual')
      expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 1 })
    }
    const error = new RequestError('offline', { code: 'NETWORK_ERROR' })
    const mock = new MockAdapter({ record: { adapter: { async request() { throw error } } } })
    await expect(mock.request({ url: '/data' })).rejects.toBe(error)
    expect(mock.recordingStats.skipped).toBe(1)
  })

  it('clears snapshots and prevents in-flight requests from repopulating them after reset', async () => {
    let release!: (value: NporaResponse) => void
    const source: Adapter = { request: () => new Promise(resolve => { release = resolve }) as never }
    const mock = new MockAdapter({ record: { adapter: source } })
    const pending = mock.request({ url: '/data' })
    mock.reset()
    release(response({ url: '/data' }, 'late'))
    expect((await pending).data).toBe('late')
    expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 0 })
    expect(mock.history).toHaveLength(0)
  })

  it('skips non-JSON shapes and invalid transforms without changing data', async () => {
    const sparse = Array(3)
    let deep: unknown = null
    for (let index = 0; index < 70; index++) deep = { deep }
    const symbol = { [Symbol('hidden')]: 'value' }
    for (const value of [undefined, NaN, -0, sparse, symbol, deep, new Uint8Array([1])]) {
      const mock = new MockAdapter({ record: { adapter: adapter(value) } })
      expect((await mock.request({ url: '/data' })).data).toBe(value)
      expect(mock.recordingStats.skipped).toBe(value === undefined ? 0 : 1)
    }
    for (const transform of [
      (value: MockRecording) => ({ ...value, method: 'INVALID' as never }),
      (value: MockRecording) => ({ ...value, matcher: { url: '/private?token=secret' } }),
      (value: MockRecording) => ({ ...value, response: { ...value.response, headers: { invalid: 'a\nb' } } })
    ]) {
      const mock = new MockAdapter({ record: { adapter: adapter('real'), transform } })
      expect((await mock.request({ url: '/data' })).data).toBe('real')
      expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 1 })
    }
  })

  it('clears during transformation and preserves legacy handlers and history controls', async () => {
    const mock = new MockAdapter({ record: {
      adapter: adapter('forwarded'), transform(value) { mock.clearRecordings(); return value }
    } })
    mock.on('/legacy', () => 'local')
    expect((await mock.request({ url: '/legacy' })).data).toBe('local')
    expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 0 })
    expect((await mock.request({ url: '/real', query: { unused: undefined, tags: ['a', undefined, 'b'] } })).data).toBe('forwarded')
    expect(mock.recordingStats).toEqual({ recorded: 0, skipped: 0 })
    expect(mock.history).toHaveLength(2)
    mock.clearRecordings()
    expect(mock.history).toHaveLength(2)
    expect((await mock.request({ url: '/legacy' })).data).toBe('local')
  })

  it('validates opt-in recording configuration and keeps ordinary mocking offline', async () => {
    for (const value of [0, -1, Infinity, NaN, 0.5]) {
      expect(() => new MockAdapter({ record: { adapter: adapter(null), maxEntries: value } })).toThrow(TypeError)
      expect(() => new MockAdapter({ record: { adapter: adapter(null), maxRecordSize: value } })).toThrow(TypeError)
    }
    expect(() => new MockAdapter({ record: {} as never })).toThrow(TypeError)
    expect(() => new MockAdapter({ record: { adapter: adapter(null), transform: 1 as never } })).toThrow(TypeError)
    const ordinary = new MockAdapter()
    expect(ordinary.recordings).toEqual([]); expect(ordinary.exportMocks()).toBe('')
    await expect(ordinary.request({ url: '/missing' })).rejects.toThrow('No mock handler')
  })
})

let server: Server, origin: string
beforeAll(async () => {
  server = createServer((request, reply) => {
    const failed = request.url === '/failure'
    reply.writeHead(failed ? 422 : 200, { 'content-type': 'application/json', 'x-fixture': 'real-http' })
    reply.end(JSON.stringify(failed ? { error: 'Invalid' } : { id: 1, name: 'Npora' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
