import {
  mkdir,
  writeFile
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

export interface BenchmarkOptions {
  operations: number
  concurrency: number
  warmup: number
  samples?: number
  output?: string
}

interface LatencySummary {
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

export interface ScenarioResult {
  operations: number
  latencySamples: number
  durationMs: number
  operationsPerSecond: number
  heapDeltaBytes: number
  latencyMs: LatencySummary
}

const BENCHMARK_OPTIONS = new Set([
  '--operations',
  '--concurrency',
  '--warmup',
  '--samples',
  '--output'
])

export function parseBenchmarkOptions(
  args: string[],
  defaults: Pick<
    BenchmarkOptions,
    'operations' | 'concurrency' | 'warmup'
  > & Partial<Pick<BenchmarkOptions, 'samples'>>
): BenchmarkOptions {
  const values = new Map<string, string>()

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === '--') {
      if (index === 0) {
        continue
      }

      break
    }

    if (!argument?.startsWith('--')) {
      continue
    }

    const [name = argument, inlineValue] = argument.split('=', 2)

    if (!BENCHMARK_OPTIONS.has(name)) {
      throw new Error(`Unknown benchmark option ${name}`)
    }

    const value = inlineValue ?? args[index + 1]

    if (inlineValue === undefined) {
      index += 1
    }

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}`)
    }

    values.set(name, value)
  }

  const options: BenchmarkOptions = {
    operations: positiveInteger(
      values.get('--operations') ??
        String(defaults.operations),
      'operations'
    ),
    concurrency: positiveInteger(
      values.get('--concurrency') ??
        String(defaults.concurrency),
      'concurrency'
    ),
    warmup: positiveInteger(
      values.get('--warmup') ??
        String(defaults.warmup),
      'warmup'
    ),
    output: values.get('--output')
  }

  if (
    values.has('--samples') ||
    defaults.samples !== undefined
  ) {
    options.samples = positiveInteger(
      values.get('--samples') ??
        String(defaults.samples),
      'samples'
    )
  }

  return options
}

export async function runSequential(
  operations: number,
  operation: () => Promise<unknown>,
  sampleLimit = 4096
): Promise<ScenarioResult> {
  const sampler = createLatencySampler(
    operations,
    sampleLimit
  )
  const heapBefore = process.memoryUsage().heapUsed
  const startedAt = performance.now()

  for (let index = 0; index < operations; index += 1) {
    const sampleIndex = sampler.claim(index)

    if (sampleIndex === undefined) {
      await operation()
      continue
    }

    const operationStartedAt = performance.now()

    await operation()
    sampler.latencies[sampleIndex] =
      performance.now() - operationStartedAt
  }

  return createResult(
    operations,
    performance.now() - startedAt,
    process.memoryUsage().heapUsed - heapBefore,
    sampler.latencies
  )
}

export async function runConcurrent(
  operations: number,
  concurrency: number,
  operation: () => Promise<unknown>,
  sampleLimit = 4096
): Promise<ScenarioResult> {
  const sampler = createLatencySampler(
    operations,
    sampleLimit
  )
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

        const sampleIndex = sampler.claim(index)

        if (sampleIndex === undefined) {
          await operation()
          continue
        }

        const operationStartedAt = performance.now()

        await operation()
        sampler.latencies[sampleIndex] =
          performance.now() - operationStartedAt
      }
    }
  )

  await Promise.all(workers)

  return createResult(
    operations,
    performance.now() - startedAt,
    process.memoryUsage().heapUsed - heapBefore,
    sampler.latencies
  )
}

export function printBenchmarkReport(
  scenarios: Record<string, ScenarioResult>
): void {
  console.table(
    Object.fromEntries(
      Object.entries(scenarios).map(
        ([name, result]) => [
          name,
          {
            operations: result.operations,
            latencySamples: result.latencySamples,
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

export async function writeBenchmarkReport(
  output: string | undefined,
  report: unknown
): Promise<void> {
  if (!output) {
    return
  }

  const outputPath = resolve(output)

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

function createResult(
  operations: number,
  durationMs: number,
  heapDeltaBytes: number,
  latencies: number[]
): ScenarioResult {
  return {
    operations,
    latencySamples: latencies.length,
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
  const sorted = latencies.sort(
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

function createLatencySampler(
  operations: number,
  sampleLimit: number
): {
  claim: (operationIndex: number) => number | undefined
  latencies: number[]
} {
  const sampleCount = Math.min(operations, sampleLimit)
  const latencies = new Array<number>(sampleCount)
  let nextSample = 0
  let nextOperation = 0

  return {
    claim(operationIndex) {
      if (operationIndex !== nextOperation) {
        return undefined
      }

      const sampleIndex = nextSample

      nextSample += 1
      nextOperation = sampleCount <= 1
        ? operations
        : Math.floor(
            nextSample * (operations - 1) /
              (sampleCount - 1)
          )

      return sampleIndex
    },
    latencies
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
