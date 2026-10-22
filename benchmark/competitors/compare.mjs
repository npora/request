import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import axios from 'axios'
import ky from 'ky'
import { ofetch } from 'ofetch'
import { createClient } from '../../dist/core.js'
import { parseBenchmarkOptions, runConcurrent, writeBenchmarkReport } from '../harness.ts'
import { hashFile, measurementMetadata } from '../provenance.mjs'

const args = process.argv.slice(2)
const largeIndex = args.indexOf('--large-json')
const largeJson = largeIndex !== -1
if (largeJson) args.splice(largeIndex, 1)
const scenarios = largeJson ? ['get-json'] : ['get-json', 'post-json', 'query-json']
const roundIndex = args.indexOf('--rounds')
const rounds = roundIndex < 0 ? 6 : Number(args.splice(roundIndex, 2)[1])
assert.ok(Number.isSafeInteger(rounds) && rounds > 0, 'rounds must be a positive integer')
const options = parseBenchmarkOptions(args, {
  operations: 5000, concurrency: 64, warmup: 500, samples: 4096
})
const versions = Object.fromEntries(['axios', 'ky', 'ofetch'].map(name => [
  name, JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, import.meta.url))).version
]))
const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url)))
assert.deepEqual(versions, manifest.dependencies, 'Install the pinned comparison dependencies with npm ci')
const metadata = measurementMetadata()
metadata.provenance.comparisonLockSha256 = hashFile(new URL('package-lock.json', import.meta.url))
let received = 0
let invalid = 0
const expected = largeJson ? { ok: true, payload: 'x'.repeat(65536) } : { ok: true }
const server = createServer(async (request, response) => {
  received++
  try {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/post-json') {
      assert.equal(request.method, 'POST')
      assert.match(request.headers['content-type'], /application\/json/)
      let body = ''
      for await (const chunk of request) body += chunk
      assert.deepEqual(JSON.parse(body), { name: 'Ada', active: true })
    } else {
      assert.equal(request.method, 'GET')
      assert.ok(['/get-json', '/query-json'].includes(url.pathname))
      if (url.pathname === '/query-json') {
        assert.equal(url.searchParams.get('page'), '1')
        assert.equal(url.searchParams.get('search'), 'hello world')
        assert.equal(url.searchParams.getAll('page').length, 1)
        assert.equal(url.searchParams.getAll('search').length, 1)
      }
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(expected))
  } catch {
    invalid++
    response.writeHead(400)
    response.end('Invalid benchmark request')
  }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')

try {
  const baseURL = `http://127.0.0.1:${server.address().port}`
  const npora = createClient({ baseURL })
  // Explicit HTTP adapter and proxy:false make the Node default transport
  // independent of the runner's HTTP_PROXY/HTTPS_PROXY environment.
  const httpAxios = axios.create({ baseURL, adapter: 'http', proxy: false })
  const fetchAxios = axios.create({ baseURL, adapter: 'fetch' })
  const payload = { name: 'Ada', active: true }
  const query = { page: 1, search: 'hello world' }
  const clients = {
    'native-fetch': async (scenario) => {
      const url = new URL(`/${scenario}`, baseURL)
      if (scenario === 'query-json') url.search = new URLSearchParams({ page: '1', search: query.search }).toString()
      const response = await fetch(url, scenario === 'post-json' ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      } : undefined)
      assert.equal(response.status, 200)
      return response.json()
    },
    '@npora/request': scenario => scenario === 'post-json'
      ? npora.post(`/${scenario}`, { json: payload })
      : npora.get(`/${scenario}`, scenario === 'query-json' ? { query } : undefined),
    'axios-http': async scenario => (await (scenario === 'post-json'
      ? httpAxios.post(`/${scenario}`, payload)
      : httpAxios.get(`/${scenario}`, { params: scenario === 'query-json' ? query : undefined }))).data,
    'axios-fetch': async scenario => (await (scenario === 'post-json'
      ? fetchAxios.post(`/${scenario}`, payload)
      : fetchAxios.get(`/${scenario}`, { params: scenario === 'query-json' ? query : undefined }))).data,
    ky: scenario => ky(`${baseURL}/${scenario}`, {
      retry: 0, timeout: false,
      ...(scenario === 'post-json' ? { method: 'post', json: payload } : {}),
      ...(scenario === 'query-json' ? { searchParams: query } : {})
    }).json(),
    ofetch: scenario => ofetch(`${baseURL}/${scenario}`, {
      retry: 0,
      ...(scenario === 'post-json' ? { method: 'POST', body: payload } : {}),
      ...(scenario === 'query-json' ? { query } : {})
    })
  }
  const results = {}
  const orders = []
  const names = Object.keys(clients)
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
  for (const scenario of scenarios) {
    const runs = Object.fromEntries(names.map(name => [name, []]))
    for (let round = 0; round < rounds; round++) {
      const offset = round % names.length
      const order = [...names.slice(offset), ...names.slice(0, offset)]
      orders.push({ scenario, round: round + 1, order })
      for (const name of order) {
        const operation = async () => assert.deepEqual(await clients[name](scenario), expected)
        const before = received
        await runConcurrent(options.warmup, options.concurrency, operation, 1)
        const result = await runConcurrent(options.operations, options.concurrency, operation, options.samples)
        assert.equal(received - before, options.warmup + options.operations, `${name}: unexpected request count`)
        assert.equal(invalid, 0, 'Server rejected benchmark requests')
        runs[name].push(result)
      }
    }
    results[scenario] = Object.fromEntries(names.map(name => [name, {
      medianRequestsPerSecond: median(runs[name].map(run => run.operationsPerSecond)),
      medianP95Milliseconds: median(runs[name].map(run => run.latencyMs.p95)),
      medianP99Milliseconds: median(runs[name].map(run => run.latencyMs.p99)),
      minRequestsPerSecond: Math.min(...runs[name].map(run => run.operationsPerSecond)),
      maxRequestsPerSecond: Math.max(...runs[name].map(run => run.operationsPerSecond)),
      runs: runs[name]
    }]))
    console.log(scenario)
    console.table(Object.fromEntries(Object.entries(results[scenario]).map(
      ([name, { runs: _runs, ...summary }]) => [name, summary]
    )))
  }
  const expectedRequests = scenarios.length * names.length * rounds * (options.operations + options.warmup)
  assert.equal(received, expectedRequests)
  await writeBenchmarkReport(options.output, {
    schemaVersion: 1, generatedAt: new Date().toISOString(), ...metadata,
    versions, configuration: { ...options, rounds,
      responseBytes: Buffer.byteLength(JSON.stringify(expected)) }, orders,
    requestsReceived: received, expectedRequests, invalidRequests: invalid, results
  })
} finally {
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
