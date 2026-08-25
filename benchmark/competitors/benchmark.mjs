import { strict as assert } from 'node:assert'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'

import axios from 'axios'
import got from 'got'
import ky from 'ky'
import { ofetch } from 'ofetch'
import { createClient } from '../../dist/index.js'

const configuration = {
  operations: 30_000,
  concurrency: 128,
  warmup: 300,
  rounds: 3
}
const body = JSON.stringify({ ok: true })
let received = 0
const server = createServer((_request, response) => {
  received += 1
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  })
  response.end(body)
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  const { port } = server.address()
  const baseURL = `http://127.0.0.1:${port}`
  const npora = createClient({ baseURL })
  const axiosClient = axios.create({ baseURL })
  const kyClient = ky.create({ prefix: baseURL })
  const gotClient = got.extend({ prefixUrl: baseURL })
  const clients = new Map([
    ['@npora/request', () => npora.get('/load')],
    ['axios', () => axiosClient.get('/load').then(result => result.data)],
    ['ky', () => kyClient.get('load').json()],
    ['got', () => gotClient.get('load').json()],
    ['ofetch', () => ofetch(`${baseURL}/load`)]
  ])
  const samples = Object.fromEntries(
    [...clients.keys()].map(name => [name, []])
  )

  for (const request of clients.values()) {
    for (let index = 0; index < configuration.warmup; index += 1) {
      assert.equal((await request()).ok, true)
    }
  }

  const names = [...clients.keys()]

  for (let round = 0; round < configuration.rounds; round += 1) {
    const order = names.slice(round).concat(names.slice(0, round))

    for (const name of order) {
      const sample = await runConcurrent(
        configuration.operations,
        configuration.concurrency,
        clients.get(name)
      )

      samples[name].push(sample)
      process.stdout.write(
        `${name} round ${round + 1}: ` +
        `${sample.requestsPerSecond.toFixed(0)} req/s, ` +
        `p99 ${sample.p99Milliseconds.toFixed(3)} ms\n`
      )
    }
  }

  const expectedRequests = clients.size * (
    configuration.warmup +
    configuration.operations * configuration.rounds
  )
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    configuration,
    versions: {
      '@npora/request': 'workspace build',
      axios: '1.19.0',
      ky: '2.0.2',
      got: '15.1.0',
      ofetch: '1.5.1'
    },
    requestsReceived: received,
    expectedRequests,
    results: Object.fromEntries(Object.entries(samples).map(
      ([name, values]) => [name, summarize(values)]
    )),
    samples
  }

  assert.equal(received, expectedRequests)
  await writeFile(
    process.env.NPORA_BENCH_OUTPUT ??
      '/tmp/npora-library-comparison.json',
    `${JSON.stringify(report, null, 2)}\n`
  )
  process.stdout.write(`${JSON.stringify(report.results, null, 2)}\n`)
} finally {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

async function runConcurrent(count, limit, operation) {
  const latencies = new Float64Array(count)
  let cursor = 0
  const startedAt = performance.now()

  await Promise.all(Array.from({ length: Math.min(count, limit) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1

      if (index >= count) {
        return
      }

      const requestStartedAt = performance.now()
      assert.equal((await operation()).ok, true)
      latencies[index] = performance.now() - requestStartedAt
    }
  }))

  const durationMilliseconds = performance.now() - startedAt
  const sorted = [...latencies].sort((first, second) => first - second)

  return {
    operations: count,
    concurrency: limit,
    durationMilliseconds,
    requestsPerSecond: count / (durationMilliseconds / 1000),
    p50Milliseconds: percentile(sorted, 0.5),
    p95Milliseconds: percentile(sorted, 0.95),
    p99Milliseconds: percentile(sorted, 0.99)
  }
}

function percentile(sorted, fraction) {
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ]
}

function summarize(values) {
  const median = key => values
    .map(value => value[key])
    .sort((first, second) => first - second)[Math.floor(values.length / 2)]
  const throughput = values
    .map(value => value.requestsPerSecond)
    .sort((first, second) => first - second)

  return {
    medianRequestsPerSecond: median('requestsPerSecond'),
    minRequestsPerSecond: throughput[0],
    maxRequestsPerSecond: throughput.at(-1),
    medianP50Milliseconds: median('p50Milliseconds'),
    medianP95Milliseconds: median('p95Milliseconds'),
    medianP99Milliseconds: median('p99Milliseconds')
  }
}
