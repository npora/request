import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import axios from 'axios'
import ky from 'ky'
import { ofetch } from 'ofetch'
import { createClient } from '../../dist/core.js'
import { parseBenchmarkOptions, runConcurrent, writeBenchmarkReport } from '../harness.ts'
import { measurementMetadata, hashFile } from '../provenance.mjs'

const options = parseBenchmarkOptions(process.argv.slice(2), {
  operations: 1000, concurrency: 64, warmup: 10, samples: 4096
})
const versions = Object.fromEntries(['axios', 'ky', 'ofetch'].map(name => [
  name, JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, import.meta.url))).version
]))
assert.deepEqual(versions, JSON.parse(readFileSync(new URL('package.json', import.meta.url))).dependencies)
const counts = { received: 0, completed: 0, disconnected: 0 }
const block = Buffer.alloc(1024, 120)
const large = JSON.stringify({ ok: true, payload: 'x'.repeat(65536) })
const server = createServer((request, response) => {
  counts.received++
  response.on('finish', () => counts.completed++)
  let timer
  response.on('close', () => {
    clearTimeout(timer)
    if (!response.writableFinished) counts.disconnected++
  })
  const scenario = request.url.slice(1)
  if (scenario === 'slow-json' || scenario === 'large-json') {
    timer = setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(scenario === 'large-json' ? large : '{"ok":true}')
    }, scenario === 'slow-json' ? 5 : 0)
    return
  }
  response.writeHead(200, { 'content-type': 'application/octet-stream' })
  let chunks = 0
  const write = () => {
    chunks++
    const ready = response.write(block)
    if (chunks === 16) { response.end(); return }
    const schedule = () => { timer = setTimeout(write, scenario === 'cancel-storm' ? 20 : 1) }
    if (ready) schedule()
    else response.once('drain', schedule)
  }
  write()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseURL = `http://127.0.0.1:${server.address().port}`
const npora = createClient({ baseURL })
const httpAxios = axios.create({ baseURL, adapter: 'http', proxy: false })
const fetchAxios = axios.create({ baseURL, adapter: 'fetch' })
const clients = {
  'native-fetch': async (path, signal, stream) => {
    const response = await fetch(`${baseURL}/${path}`, { signal })
    return stream ? response.body : response.json()
  },
  '@npora/request': (path, signal, stream) => npora.get(`/${path}`, {
    signal, responseType: stream ? 'stream' : 'json'
  }),
  'axios-http': async (path, signal, stream) => {
    const { data } = await httpAxios.get(`/${path}`, { signal, responseType: stream ? 'stream' : 'json' })
    return stream ? Readable.toWeb(data) : data
  },
  'axios-fetch': async (path, signal, stream) => (await fetchAxios.get(`/${path}`, {
    signal, responseType: stream ? 'stream' : 'json'
  })).data,
  ky: async (path, signal, stream) => {
    const response = await ky(`${baseURL}/${path}`, { signal, retry: 0, timeout: false })
    return stream ? response.body : response.json()
  },
  ofetch: (path, signal, stream) => ofetch(`${baseURL}/${path}`, {
    signal, retry: 0, responseType: stream ? 'stream' : 'json'
  })
}
const results = []
try {
  for (const scenario of ['slow-json', 'large-json', 'cancel-storm', 'stream-backpressure']) {
    // Rotate order across scenarios. This diagnostic run is not a ranking or CI gate.
    const names = Object.keys(clients)
    const shift = results.length / names.length
    for (const name of [...names.slice(shift), ...names.slice(0, shift)]) {
      let cancellations = 0
      let consumedBytes = 0
      const operation = async () => {
        const controller = new AbortController()
        const stream = scenario === 'cancel-storm' || scenario === 'stream-backpressure'
        const data = await clients[name](scenario, controller.signal, stream)
        if (!stream) {
          assert.equal(data.ok, true)
          if (scenario === 'large-json') assert.equal(data.payload, 'x'.repeat(65536))
          return
        }
        const reader = data.getReader()
        try {
          if (scenario === 'cancel-storm') {
            assert.equal((await reader.read()).done, false)
            controller.abort()
            // Transport buffers can already contain data. Require eventual rejection,
            // and do not label queued-data semantics as equivalent across libraries.
            let rejected = false
            try { while (!(await reader.read()).done) {} } catch { rejected = true }
            assert.equal(rejected, true, `${name}: cancellation must reject the active body`)
            cancellations++
          } else {
            let size = 0
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              assert.ok(value.every(byte => byte === 120))
              size += value.byteLength
              await new Promise(resolve => setTimeout(resolve, 2))
            }
            assert.equal(size, 16 * block.byteLength)
            consumedBytes += size
          }
        } finally { reader.releaseLock() }
      }
      await runConcurrent(options.warmup, options.concurrency, operation, 1)
      cancellations = 0
      consumedBytes = 0
      const before = { ...counts }
      const result = await runConcurrent(options.operations, options.concurrency, operation, options.samples)
      results.push({ scenario, client: name, ...result, cancellations, consumedBytes,
        server: Object.fromEntries(Object.keys(counts).map(key => [key, counts[key] - before[key]])) })
    }
  }
} finally {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
}
console.table(results.map(({ scenario, client, operationsPerSecond, cancellations, consumedBytes }) => ({
  scenario, client, operationsPerSecond, cancellations, consumedBytes
})))
await writeBenchmarkReport(options.output, {
  schemaVersion: 1, generatedAt: new Date().toISOString(), ...measurementMetadata(),
  versions, comparisonLockSha256: hashFile(new URL('package-lock.json', import.meta.url)),
  configuration: options, results, server: counts,
  limitations: [
    'One local loopback run per client/scenario, shared process, no TLS or remote latency.',
    'Library transport/pool differences remain; streaming Axios HTTP needs a Node-to-Web bridge.',
    'Consumer delay approximates backpressure; this is not a retained-memory or production capacity measurement.',
    'Server disconnect accounting is asynchronous; per-client disconnect deltas can include preceding cancellations.',
    'Abort scenario checks eventual rejection after headers; it does not assert identical buffered-data semantics.'
  ]
})
