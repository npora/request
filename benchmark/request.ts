import {
  mkdir,
  writeFile
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  createClient,
  MockAdapter,
  type Plugin,
  type RequestConfig
} from '../src'

interface BenchmarkOptions {
  operations: number
  concurrency: number
  warmup: number
  output?: string
}

interface LatencySummary {
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

interface ScenarioResult {
  operations: number
  durationMs: number
  operationsPerSecond: number
  heapDeltaBytes: number
  latencyMs: LatencySummary
}

const options = parseOptions(process.argv.slice(2))
const adapter = new MockAdapter({
  handlers: {
    '/benchmark': config => ({
      ok: true,
      id: config.query?.id
    })
  }
})
const requestConfig: RequestConfig = {
  url: '/benchmark',
  method: 'GET',
  headers: {
    accept: 'application/json',
    'x-benchmark': 'request'
  },
  query: {
    id: 1,
    mode: 'benchmark'
  }
}
const client = createClient({
  adapter,
  headers: {
    'x-client': 'npora'
  }
})
const pipelineClient = createClient({
  adapter
}).use(createBenchmarkPlugin())
const originalFetch = globalThis.fetch
const fetchClient = createClient({
  baseURL: 'https://benchmark.example.com',
  headers: {
    accept: 'text/plain',
    'x-client': 'npora'
  }
})

globalThis.fetch = async () => {
  return new Response('ok', {
    status: 200,
    headers: {
      'content-type': 'text/plain'
    }
  })
}

await warmUp(options.warmup)

const direct = await runSequential(
  options.operations,
  () => adapter.request(requestConfig)
)
const sequential = await runSequential(
  options.operations,
  () => client.get('/benchmark', requestConfig)
)
const concurrent = await runConcurrent(
  options.operations,
  options.concurrency,
  () => client.get('/benchmark', requestConfig)
)
const pluginPipeline = await runConcurrent(
  options.operations,
  options.concurrency,
  () => pipelineClient.get('/benchmark', requestConfig)
)
const fetchAdapterClient = await runSequential(
  options.operations,
  () => fetchClient.get('/benchmark', {
    headers: {
      'x-request': 'benchmark'
    },
    responseType: 'text'
  })
)
const fetchAdapterCompleteResponse = await runSequential(
  options.operations,
  () => fetchClient.getResponse('/benchmark', {
    headers: {
      'x-request': 'benchmark'
    },
    responseType: 'text'
  })
)

globalThis.fetch = originalFetch

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch
  },
  configuration: {
    operations: options.operations,
    concurrency: options.concurrency,
    warmup: options.warmup
  },
  scenarios: {
    directAdapter: direct,
    sequentialClient: sequential,
    concurrentClient: concurrent,
    concurrentPluginPipeline: pluginPipeline,
    fetchAdapterClient,
    fetchAdapterCompleteResponse
  },
  comparison: {
    sequentialClientOverhead:
      direct.operationsPerSecond /
      sequential.operationsPerSecond,
    pluginPipelineThroughputRatio:
      pluginPipeline.operationsPerSecond /
      concurrent.operationsPerSecond
  }
}

printReport(report.scenarios)

if (options.output) {
  const outputPath = resolve(options.output)

  await mkdir(dirname(outputPath), {
    recursive: true
  })
  await writeFile(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  )
  console.log(`\nJSON report: ${outputPath}`)
}

async function warmUp(iterations: number): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await client.get('/benchmark', requestConfig)
    await pipelineClient.get('/benchmark', requestConfig)
    await fetchClient.get('/benchmark', {
      responseType: 'text'
    })
  }
}

async function runSequential(
  operations: number,
  operation: () => Promise<unknown>
): Promise<ScenarioResult> {
  const latencies = new Array<number>(operations)
  const heapBefore = process.memoryUsage().heapUsed
  const startedAt = performance.now()

  for (let index = 0; index < operations; index += 1) {
    const operationStartedAt = performance.now()

    await operation()
    latencies[index] =
      performance.now() - operationStartedAt
  }

  return createResult(
    operations,
    performance.now() - startedAt,
    process.memoryUsage().heapUsed - heapBefore,
    latencies
  )
}

async function runConcurrent(
  operations: number,
  concurrency: number,
  operation: () => Promise<unknown>
): Promise<ScenarioResult> {
  const latencies = new Array<number>(operations)
  const heapBefore = process.memoryUsage().heapUsed
  const startedAt = performance.now()
  let nextOperation = 0

  const workers = Array.from(
    {
      length: Math.min(concurrency, operations)
    },
    async () => {
      while (true) {
        const index = nextOperation

        nextOperation += 1

        if (index >= operations) {
          return
        }

        const operationStartedAt = performance.now()

        await operation()
        latencies[index] =
          performance.now() - operationStartedAt
      }
    }
  )

  await Promise.all(workers)

  return createResult(
    operations,
    performance.now() - startedAt,
    process.memoryUsage().heapUsed - heapBefore,
    latencies
  )
}

function createResult(
  operations: number,
  durationMs: number,
  heapDeltaBytes: number,
  latencies: number[]
): ScenarioResult {
  return {
    operations,
    durationMs,
    operationsPerSecond:
      operations / (durationMs / 1000),
    heapDeltaBytes,
    latencyMs: summarizeLatencies(latencies)
  }
}

function summarizeLatencies(
  latencies: number[]
): LatencySummary {
  const sorted = [...latencies].sort(
    (left, right) => left - right
  )
  const total = sorted.reduce(
    (sum, latency) => sum + latency,
    0
  )

  return {
    mean: total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0
  }
}

function percentile(
  sorted: number[],
  ratio: number
): number {
  const index = Math.min(
    Math.ceil(sorted.length * ratio) - 1,
    sorted.length - 1
  )

  return sorted[Math.max(index, 0)] ?? 0
}

function createBenchmarkPlugin(): Plugin {
  return {
    name: 'benchmark',

    install({ interceptors, hooks }) {
      interceptors.request.use(config => ({
        ...config,
        headers: {
          ...Object.fromEntries(
            new Headers(config.headers)
          ),
          'x-plugin': 'benchmark'
        }
      }))
      hooks.onRequest(() => {})
      hooks.onResponse(() => {})
      interceptors.response.use(response => response)
    }
  }
}

function parseOptions(args: string[]): BenchmarkOptions {
  const values = new Map<string, string>()

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (
      argument === '--' ||
      !argument?.startsWith('--')
    ) {
      continue
    }

    const [name, inlineValue] = argument.split('=', 2)
    const value =
      inlineValue ??
      args[index + 1]

    if (inlineValue === undefined) {
      index += 1
    }

    if (value !== undefined) {
      values.set(name, value)
    }
  }

  return {
    operations: positiveInteger(
      values.get('--operations') ?? '5000',
      'operations'
    ),
    concurrency: positiveInteger(
      values.get('--concurrency') ?? '50',
      'concurrency'
    ),
    warmup: positiveInteger(
      values.get('--warmup') ?? '250',
      'warmup'
    ),
    output: values.get('--output')
  }
}

function positiveInteger(
  value: string,
  name: string
): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `--${name} must be a positive integer`
    )
  }

  return parsed
}

function printReport(
  scenarios: Record<string, ScenarioResult>
): void {
  console.table(
    Object.fromEntries(
      Object.entries(scenarios).map(
        ([name, result]) => [
          name,
          {
            operations: result.operations,
            durationMs:
              result.durationMs.toFixed(2),
            operationsPerSecond:
              result.operationsPerSecond.toFixed(0),
            p50Ms:
              result.latencyMs.p50.toFixed(3),
            p95Ms:
              result.latencyMs.p95.toFixed(3),
            p99Ms:
              result.latencyMs.p99.toFixed(3),
            heapDeltaMiB:
              (
                result.heapDeltaBytes /
                1024 /
                1024
              ).toFixed(2)
          }
        ]
      )
    )
  )
}
