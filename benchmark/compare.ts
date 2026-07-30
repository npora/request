import assert from 'node:assert/strict'
import axios from 'axios'
import {
  createClient
} from '../src'
import {
  parseBenchmarkOptions,
  printBenchmarkReport,
  runConcurrent,
  runSequential,
  type ScenarioResult,
  writeBenchmarkReport
} from './harness'

interface Payload {
  ok: boolean
  id: number
}

const options = parseBenchmarkOptions(
  process.argv.slice(2),
  {
    operations: 3000,
    concurrency: 50,
    warmup: 200,
    samples: 5
  }
)
const baseURL = 'https://benchmark.example.com'
const responseBody = JSON.stringify({
  ok: true,
  id: 1
})
const originalFetch = globalThis.fetch
let validateRequests = true

const npora = createClient({
  baseURL,
  headers: {
    accept: 'application/json',
    'x-benchmark': 'comparison'
  }
})
const axiosFetch = axios.create({
  adapter: 'fetch',
  baseURL,
  headers: {
    accept: 'application/json',
    'x-benchmark': 'comparison'
  }
})

const nativeOperation = async (): Promise<Payload> => {
  const url = new URL('/benchmark', baseURL)

  url.searchParams.set('id', '1')
  url.searchParams.set('mode', 'comparison')

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-benchmark': 'comparison'
    }
  })

  return response.json() as Promise<Payload>
}
const nporaOperation = async (): Promise<Payload> => {
  return npora.get<Payload>('/benchmark', {
    query: {
      id: 1,
      mode: 'comparison'
    },
    responseType: 'json'
  })
}
const axiosOperation = async (): Promise<Payload> => {
  const response = await axiosFetch.get<Payload>(
    '/benchmark',
    {
      params: {
        id: 1,
        mode: 'comparison'
      },
      responseType: 'json'
    }
  )

  return response.data
}
const competitors: ReadonlyArray<{
  name: CompetitorName
  operation: () => Promise<Payload>
}> = [
  {
    name: 'nativeFetch',
    operation: nativeOperation
  },
  {
    name: 'npora',
    operation: nporaOperation
  },
  {
    name: 'axiosFetch',
    operation: axiosOperation
  }
]

globalThis.fetch = async (input, init) => {
  if (validateRequests) {
    validateEquivalentRequest(input, init)
  }

  return new Response(responseBody, {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

try {
  await warmUp()
  validateRequests = false

  const scenarios = {
    ...await measure('Sequential'),
    ...await measure('Concurrent')
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    dependencies: {
      axios: axios.VERSION
    },
    configuration: {
      operations: options.operations,
      concurrency: options.concurrency,
      warmup: options.warmup,
      samples: options.samples,
      aggregation: 'median throughput sample',
      transport: 'in-memory Fetch response',
      responseType: 'json'
    },
    scenarios,
    comparison: {
      sequentialThroughput: {
        nporaToNative:
          scenarios.nporaSequential.operationsPerSecond /
          scenarios.nativeFetchSequential.operationsPerSecond,
        nporaToAxios:
          scenarios.nporaSequential.operationsPerSecond /
          scenarios.axiosFetchSequential.operationsPerSecond
      },
      concurrentThroughput: {
        nporaToNative:
          scenarios.nporaConcurrent.operationsPerSecond /
          scenarios.nativeFetchConcurrent.operationsPerSecond,
        nporaToAxios:
          scenarios.nporaConcurrent.operationsPerSecond /
          scenarios.axiosFetchConcurrent.operationsPerSecond
      }
    }
  }

  printBenchmarkReport(scenarios)
  await writeBenchmarkReport(options.output, report)
} finally {
  globalThis.fetch = originalFetch
}

async function warmUp(): Promise<void> {
  for (
    let index = 0;
    index < options.warmup;
    index += 1
  ) {
    assert.deepEqual(
      await nativeOperation(),
      {
        ok: true,
        id: 1
      }
    )
    assert.deepEqual(
      await nporaOperation(),
      {
        ok: true,
        id: 1
      }
    )
    assert.deepEqual(
      await axiosOperation(),
      {
        ok: true,
        id: 1
      }
    )
  }
}

type Mode = 'Sequential' | 'Concurrent'
type CompetitorName =
  | 'nativeFetch'
  | 'npora'
  | 'axiosFetch'
type ScenarioName = `${CompetitorName}${Mode}`

async function measure<M extends Mode>(
  mode: M
): Promise<Record<
  `${CompetitorName}${M}`,
  ScenarioResult
>> {
  const results = new Map<
    ScenarioName,
    ScenarioResult[]
  >()
  const samples = options.samples ?? 1

  for (
    let sample = 0;
    sample < samples;
    sample += 1
  ) {
    for (
      let offset = 0;
      offset < competitors.length;
      offset += 1
    ) {
      const competitor = competitors[
        (sample + offset) % competitors.length
      ]

      if (!competitor) {
        continue
      }

      const name: ScenarioName =
        `${competitor.name}${mode}`
      const result = mode === 'Sequential'
        ? await runSequential(
            options.operations,
            competitor.operation
          )
        : await runConcurrent(
            options.operations,
            options.concurrency,
            competitor.operation
          )
      const samplesForScenario =
        results.get(name) ?? []

      samplesForScenario.push(result)
      results.set(name, samplesForScenario)
    }
  }

  return Object.fromEntries(
    [...results].map(([name, samples_]) => [
      name,
      medianThroughputSample(samples_)
    ])
  ) as Record<
    `${CompetitorName}${M}`,
    ScenarioResult
  >
}

function medianThroughputSample(
  samples: ScenarioResult[]
): ScenarioResult {
  const sorted = [...samples].sort(
    (left, right) => (
      left.operationsPerSecond -
      right.operationsPerSecond
    )
  )

  return sorted[Math.floor(sorted.length / 2)]!
}

function validateEquivalentRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): void {
  const request = new Request(input, init)
  const url = new URL(request.url)

  assert.equal(request.method, 'GET')
  assert.equal(url.pathname, '/benchmark')
  assert.equal(url.searchParams.get('id'), '1')
  assert.equal(
    url.searchParams.get('mode'),
    'comparison'
  )
  assert.equal(
    request.headers.get('accept'),
    'application/json'
  )
  assert.equal(
    request.headers.get('x-benchmark'),
    'comparison'
  )
}
