import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import axios from 'axios'
import got from 'got'
import ky from 'ky'
import { ofetch } from 'ofetch'
import { createClient } from '../../dist/index.js'

const ALL_SCENARIOS = ['get-json', 'post-json', 'query-json']
const configuration = parseOptions(process.argv.slice(2))
const responseBody = JSON.stringify({ ok: true })
const requestPayload = { filter: 'active', limit: 20 }
const expectedRequestBody = JSON.stringify(requestPayload)
const received = new Map(ALL_SCENARIOS.map(name => [name, 0]))

const server = createServer(async (request, response) => {
  try {
    const scenario = new URL(
      request.url ?? '/',
      'http://127.0.0.1'
    ).pathname.slice(1)

    assert.ok(
      configuration.scenarios.includes(scenario),
      `Unexpected benchmark route: ${scenario}`
    )

    const expectedMethod = scenario === 'get-json'
      ? 'GET'
      : scenario === 'post-json'
        ? 'POST'
        : 'QUERY'
    const body = await readBody(request)

    assert.equal(request.method, expectedMethod)
    assert.equal(
      body,
      expectedMethod === 'GET' ? '' : expectedRequestBody
    )

    if (expectedMethod !== 'GET') {
      assert.match(
        request.headers['content-type'] ?? '',
        /^application\/json(?:;|$)/i
      )
    }

    received.set(scenario, (received.get(scenario) ?? 0) + 1)
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(responseBody)
    })
    response.end(responseBody)
  } catch {
    response.writeHead(500, { 'content-type': 'text/plain' })
    response.end('Benchmark request validation failed')
  }
})

await new Promise((resolvePromise, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolvePromise)
})

try {
  const address = server.address()

  assert.ok(address && typeof address === 'object')

  const baseURL = `http://127.0.0.1:${address.port}`
  const clients = createClients(baseURL)
  const results = {}
  const samples = {}

  for (const scenario of configuration.scenarios) {
    const scenarioSamples = Object.fromEntries(
      [...clients.keys()].map(name => [name, []])
    )

    for (const operations of clients.values()) {
      const operation = operations[scenario]

      for (let index = 0; index < configuration.warmup; index += 1) {
        assert.equal((await operation()).ok, true)
      }
    }

    const names = [...clients.keys()]

    for (let round = 0; round < configuration.rounds; round += 1) {
      const order = names.slice(round).concat(names.slice(0, round))

      for (const name of order) {
        const sample = await runConcurrent(
          configuration.operations,
          configuration.concurrency,
          clients.get(name)[scenario]
        )

        scenarioSamples[name].push(sample)
        process.stdout.write(
          `${scenario} · ${name} · round ${round + 1}: ` +
          `${sample.requestsPerSecond.toFixed(0)} req/s, ` +
          `p99 ${sample.p99Milliseconds.toFixed(3)} ms\n`
        )
      }
    }

    samples[scenario] = scenarioSamples
    results[scenario] = Object.fromEntries(
      Object.entries(scenarioSamples).map(
        ([name, values]) => [name, summarize(values)]
      )
    )
  }

  const requestsPerScenario = clients.size * (
    configuration.warmup +
    configuration.operations * configuration.rounds
  )

  for (const scenario of configuration.scenarios) {
    assert.equal(received.get(scenario), requestsPerScenario)
  }

  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    configuration,
    versions: await readVersions(),
    requestsReceived: Object.fromEntries(received),
    expectedRequestsPerScenario: requestsPerScenario,
    results,
    samples
  }

  const output = configuration.output
    ? resolve(configuration.output)
    : new URL('library-comparison-result.json', import.meta.url)

  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} finally {
  await new Promise((resolvePromise, reject) => {
    server.close(error => error ? reject(error) : resolvePromise())
    server.closeAllConnections()
  })
}

function createClients(baseURL) {
  const npora = createClient({ baseURL })
  const axiosClient = axios.create({ baseURL })
  const kyClient = ky.create({ prefix: baseURL })
  const gotClient = got.extend({ prefixUrl: baseURL })
  const ofetchClient = ofetch.create({ baseURL })

  return new Map([
    ['@npora/request', {
      'get-json': () => npora.get('/get-json'),
      'post-json': () => npora.post('/post-json', {
        json: requestPayload
      }),
      'query-json': () => npora.query('/query-json', {
        json: requestPayload
      })
    }],
    ['axios', {
      'get-json': () => axiosClient.get('/get-json').then(readAxiosData),
      'post-json': () => axiosClient.post(
        '/post-json',
        requestPayload
      ).then(readAxiosData),
      'query-json': () => axiosClient.query(
        '/query-json',
        requestPayload
      ).then(readAxiosData)
    }],
    ['ky', {
      'get-json': () => kyClient.get('get-json').json(),
      'post-json': () => kyClient.post('post-json', {
        json: requestPayload
      }).json(),
      'query-json': () => kyClient('query-json', {
        method: 'QUERY',
        json: requestPayload
      }).json()
    }],
    ['got', {
      'get-json': () => gotClient.get('get-json').json(),
      'post-json': () => gotClient.post('post-json', {
        json: requestPayload
      }).json(),
      'query-json': () => gotClient('query-json', {
        method: 'QUERY',
        json: requestPayload
      }).json()
    }],
    ['ofetch', {
      'get-json': () => ofetchClient('/get-json'),
      'post-json': () => ofetchClient('/post-json', {
        method: 'POST',
        body: requestPayload
      }),
      'query-json': () => ofetchClient('/query-json', {
        method: 'QUERY',
        body: expectedRequestBody,
        headers: { 'content-type': 'application/json' }
      })
    }]
  ])
}

function readAxiosData(response) {
  return response.data
}

function parseOptions(args) {
  const values = new Map()
  const allowedOptions = new Set([
    '--operations',
    '--concurrency',
    '--warmup',
    '--rounds',
    '--scenarios',
    '--output'
  ])

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (!argument?.startsWith('--')) {
      continue
    }

    const [name, inlineValue] = argument.split('=', 2)
    const value = inlineValue ?? args[index + 1]

    assert.ok(allowedOptions.has(name), `Unknown option: ${name}`)

    if (inlineValue === undefined) {
      index += 1
    }

    assert.ok(value, `Missing value for ${name}`)
    values.set(name, value)
  }

  const scenarios = (values.get('--scenarios') ?? ALL_SCENARIOS.join(','))
    .split(',')
    .filter(Boolean)

  assert.ok(scenarios.length > 0, 'At least one scenario is required')
  assert.equal(
    new Set(scenarios).size,
    scenarios.length,
    'Scenarios must not be duplicated'
  )

  for (const scenario of scenarios) {
    assert.ok(
      ALL_SCENARIOS.includes(scenario),
      `Unknown scenario: ${scenario}`
    )
  }

  return {
    operations: positiveInteger(
      values.get('--operations') ?? '10000',
      'operations'
    ),
    concurrency: positiveInteger(
      values.get('--concurrency') ?? '128',
      'concurrency'
    ),
    warmup: nonNegativeInteger(
      values.get('--warmup') ?? '100',
      'warmup'
    ),
    rounds: positiveInteger(
      values.get('--rounds') ?? '3',
      'rounds'
    ),
    scenarios,
    output: values.get('--output')
  }
}

function positiveInteger(value, name) {
  const number = Number(value)

  assert.ok(
    Number.isSafeInteger(number) && number > 0,
    `${name} must be a positive integer`
  )

  return number
}

function nonNegativeInteger(value, name) {
  const number = Number(value)

  assert.ok(
    Number.isSafeInteger(number) && number >= 0,
    `${name} must be a non-negative integer`
  )

  return number
}

async function readVersions() {
  return {
    '@npora/request': await readVersion('../../package.json'),
    axios: await readVersion('node_modules/axios/package.json'),
    ky: await readVersion('node_modules/ky/package.json'),
    got: await readVersion('node_modules/got/package.json'),
    ofetch: await readVersion('node_modules/ofetch/package.json')
  }
}

async function readVersion(relativePath) {
  const contents = await readFile(
    new URL(relativePath, import.meta.url),
    'utf8'
  )

  return JSON.parse(contents).version
}

async function readBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
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
