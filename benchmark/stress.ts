import { performance } from 'node:perf_hooks'
import {
  authPlugin,
  cachePlugin,
  circuitBreakerPlugin,
  concurrencyPlugin,
  createClient,
  downloadPlugin,
  loggerPlugin,
  RequestError,
  retryPlugin,
  uploadPlugin,
  type Adapter,
  type CacheStore,
  type NporaResponse,
  type Plugin,
  type RequestConfig,
  type StandardSchemaV1
} from '../src'
import {
  parseBenchmarkOptions,
  writeBenchmarkReport
} from './harness'

const DEFAULT_OPERATIONS = 10_000_000
const SAMPLE_LIMIT = 4096
const EMPTY_RAW_RESPONSE = new Response(null, { status: 200 })
const EMPTY_HEADERS = new Headers()
let deferredAdapterAttempts = 0
let retryAttempts = 0
let asyncCircuitAttempts = 0
let authRefreshCalls = 0
let authTokenCancellationCalls = 0
let cacheReadCancellationCalls = 0
const options = parseBenchmarkOptions(process.argv.slice(2), {
  operations: DEFAULT_OPERATIONS,
  concurrency: 64,
  warmup: 200
})

interface StressScenario {
  name: string
  weight: number
  concurrency?: number
  operation(index: number): Promise<unknown>
  verify?(): void | Promise<void>
}

interface StressResult {
  operations: number
  durationMs: number
  operationsPerSecond: number
  failures: number
  firstFailure?: string
  heapDeltaBytes: number
  peakRssBytes: number
  latencySampleSize: number
  latencyMs: {
    mean: number
    p50: number
    p95: number
    p99: number
    max: number
  }
}

const stressSchema: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'stress',
    validate(value) {
      return { value }
    }
  }
}

class StressXMLHttpRequest {
  method = ''
  url = ''
  responseType: XMLHttpRequestResponseType = ''
  withCredentials = false
  status = 200
  statusText = 'OK'
  response: unknown = new Blob(['npora'])
  upload = {
    onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null
  }
  onload: ((event: ProgressEvent) => void) | null = null
  onerror: ((event: ProgressEvent) => void) | null = null
  onabort: ((event: ProgressEvent) => void) | null = null
  onprogress: ((event: ProgressEvent<EventTarget>) => void) | null = null

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(): void {}

  getAllResponseHeaders(): string {
    return 'content-length: 5\r\ncontent-type: application/octet-stream\r\n'
  }

  send(): void {
    this.upload.onprogress?.(progressEvent(5, 5))
    this.onprogress?.(progressEvent(5, 5))
    this.onload?.({} as ProgressEvent)
  }

  abort(): void {
    this.onabort?.({} as ProgressEvent)
  }
}

const stableAdapter = createStableAdapter()
const bareClient = createClient({ adapter: stableAdapter })
const configuredClient = createClient({
  adapter: stableAdapter,
  baseURL: 'https://stress.example.com',
  headers: { 'x-client': 'npora' }
})
const hookClient = createClient({ adapter: stableAdapter })
  .use(lifecyclePlugin())
const cacheHitClient = createClient({ adapter: stableAdapter })
  .use(cachePlugin({ maxEntries: 16 }))
const cacheDedupeClient = createClient({
  adapter: createDeferredAdapter()
}).use(cachePlugin({ maxEntries: 16 }))
const cacheClearPlugin = cachePlugin({ maxEntries: 16 })
const cacheClearClient = createClient({
  adapter: createMicrotaskAdapter()
}).use(cacheClearPlugin)
const concurrencyImmediateClient = createClient({ adapter: stableAdapter })
  .use(concurrencyPlugin({ maxConcurrent: options.concurrency }))
const concurrencyContendedClient = createClient({ adapter: stableAdapter })
  .use(concurrencyPlugin({ maxConcurrent: 1, queueTimeout: Infinity }))
const queueCancellationClient = createClient({
  adapter: createMicrotaskAdapter()
}).use(concurrencyPlugin({ maxConcurrent: 1, queueTimeout: Infinity }))
const circuitSuccessClient = createClient({ adapter: stableAdapter })
  .use(circuitBreakerPlugin())
const circuitCycleBreaker = circuitBreakerPlugin({
  failureThreshold: 1,
  resetTimeout: 0
})
const circuitCycleClient = createClient({
  adapter: createAlternatingAdapter()
}).use(circuitCycleBreaker)
const asyncCircuitClient = createClient({
  adapter: createAsyncCircuitFailureAdapter()
}).use(circuitBreakerPlugin({
  failureThreshold: 1,
  resetTimeout: 0,
  halfOpenMaxRequests: 1,
  async shouldCountFailure() {
    await Promise.resolve()
    return true
  }
}))
const retryClient = createClient({
  adapter: createRetryAdapter()
}).use(retryPlugin({ retries: 1, delay: 0 }))
const authLoggerClient = createClient({ adapter: stableAdapter })
  .use(authPlugin({ token: 'stress-token' }))
  .use(loggerPlugin({
    logger: {
      info() {},
      error() {}
    }
  }))
const authRefreshClient = createClient({
  adapter: createAuthRefreshAdapter()
}).use(authPlugin({
  token: 'expired-stress-token',
  async refreshToken() {
    authRefreshCalls += 1
    await Promise.resolve()
    await Promise.resolve()
    return 'refreshed-stress-token'
  }
}))
const authTokenCancellationClient = createClient({
  adapter: stableAdapter
}).use(authPlugin({
  async token() {
    authTokenCancellationCalls += 1
    await Promise.resolve()
    return 'cancelled-stress-token'
  }
}))
const cancellationCacheStore: CacheStore = {
  async get() {
    cacheReadCancellationCalls += 1
    await Promise.resolve()
    return undefined
  },
  set() {},
  delete() {},
  clear() {}
}
const cacheReadCancellationClient = createClient({
  adapter: stableAdapter
}).use(cachePlugin({ store: cancellationCacheStore }))
const retryPolicyCancellationClient = createClient({
  adapter: createAlwaysFailingAdapter()
}).use(retryPlugin({
  retries: 1,
  async shouldRetry() {
    await Promise.resolve()
    return true
  }
}))
const circuitPolicyCancellationClient = createClient({
  adapter: createAlwaysFailingAdapter()
}).use(circuitBreakerPlugin({
  async shouldCountFailure() {
    await Promise.resolve()
    return true
  }
}))
const schemaClient = createClient({ adapter: stableAdapter })
const errorClient = createClient({ adapter: createErrorAdapter() })
const mixedClient = createClient({ adapter: stableAdapter })
  .use(authPlugin({ token: 'stress-token' }))
  .use(concurrencyPlugin({ maxConcurrent: options.concurrency }))
  .use(circuitBreakerPlugin())
  .use(retryPlugin({ retries: 1, delay: 0 }))
  .use(loggerPlugin({ logger: { info() {}, error() {} } }))
const disabledPluginClient = createClient({ adapter: stableAdapter })
  .use(cachePlugin())
  .use(concurrencyPlugin())
  .use(circuitBreakerPlugin())
  .use(loggerPlugin({ logger: { info() {}, error() {} } }))

const originalFetch = globalThis.fetch
const originalXMLHttpRequest = globalThis.XMLHttpRequest
const textEncoder = new TextEncoder()
let uploadFetchCalls = 0
let uploadXhrProgress = 0
let downloadFetchProgress = 0
let downloadXhrProgress = 0
let streamRecords = 0

globalThis.fetch = async input => createFetchResponse(String(input))
globalThis.XMLHttpRequest = StressXMLHttpRequest as unknown as typeof XMLHttpRequest

const uploadFetchClient = createClient().use(uploadPlugin())
const uploadXhrClient = createClient().use(uploadPlugin())
const downloadFetchClient = createClient().use(
  downloadPlugin({ transport: 'fetch' })
)
const downloadXhrClient = createClient().use(
  downloadPlugin({ transport: 'xhr' })
)
const streamingClient = createClient()

const scenarios: StressScenario[] = [
  {
    name: 'coreBare',
    weight: 1_600_000,
    operation: () => bareClient.get('/core')
  },
  {
    name: 'configSerialization',
    weight: 800_000,
    operation: index => configuredClient.post('/config#fragment', {
      headers: { 'x-request': String(index & 15) },
      query: { id: index, tag: ['stress', 'request'] },
      json: { index, ok: true }
    })
  },
  {
    name: 'interceptorLifecycle',
    weight: 600_000,
    operation: () => hookClient.get('/hooks')
  },
  {
    name: 'cacheHit',
    weight: 600_000,
    operation: () => cacheHitClient.get('/cache', {
      extensions: { cache: { enabled: true, ttl: Infinity, key: 'hit' } }
    })
  },
  {
    name: 'cacheDedupe',
    weight: 400_000,
    concurrency: Math.max(2, options.concurrency),
    operation: index => cacheDedupeClient.get('/dedupe', {
      extensions: {
        cache: {
          enabled: true,
          ttl: 0,
          key: `batch-${Math.floor(index / options.concurrency)}`
        }
      }
    })
  },
  {
    name: 'cacheClearRaces',
    weight: 100_000,
    operation: async index => {
      const config = {
        extensions: {
          cache: {
            enabled: true,
            ttl: Infinity,
            key: 'clear-race'
          }
        }
      }
      const first = (index & 1) === 0
        ? cacheClearClient.get('/clear-race', config)
        : cacheClearClient.getResponse('/clear-race', config)
      const follower = (index & 1) === 0
        ? cacheClearClient.get('/clear-race', config)
        : cacheClearClient.getResponse('/clear-race', config)

      cacheClearPlugin.clear()
      await Promise.all([first, follower])
    }
  },
  {
    name: 'concurrencyImmediate',
    weight: 700_000,
    operation: () => concurrencyImmediateClient.get('/concurrency')
  },
  {
    name: 'concurrencyContended',
    weight: 600_000,
    operation: () => concurrencyContendedClient.get('/concurrency')
  },
  {
    name: 'queueCancellation',
    weight: 200_000,
    concurrency: Math.max(2, options.concurrency),
    operation: async index => {
      if ((index & 1) === 0) {
        return queueCancellationClient.get('/queue')
      }

      const controller = new AbortController()
      const pending = queueCancellationClient.get('/queue', {
        signal: controller.signal
      })
      controller.abort('stress cancellation')
      await pending.catch(assertAbortError)
    }
  },
  {
    name: 'circuitClosed',
    weight: 600_000,
    operation: () => circuitSuccessClient.get('/circuit')
  },
  {
    name: 'circuitTransitions',
    weight: 300_000,
    concurrency: 1,
    operation: async () => {
      await circuitCycleClient.get('/circuit-cycle', {
        extensions: { circuitBreaker: { key: 'cycle' } }
      }).catch(assertExpectedCircuitFailure)
    }
  },
  {
    name: 'circuitAsyncPolicy',
    weight: 100_000,
    operation: async () => {
      await asyncCircuitClient
        .get('/circuit-async-policy')
        .catch(assertExpectedCircuitFailure)
    },
    verify() {
      assert(asyncCircuitAttempts > 0, 'Async circuit probes were not used')
    }
  },
  {
    name: 'retryOnce',
    weight: 600_000,
    operation: () => retryClient.get('/retry')
  },
  {
    name: 'authAndLogger',
    weight: 400_000,
    operation: () => authLoggerClient.get('/private?token=redacted')
  },
  {
    name: 'authRefreshCancellation',
    weight: 100_000,
    operation: async index => {
      if ((index & 1) === 0) {
        return authRefreshClient.get('/auth-refresh')
      }

      const controller = new AbortController()
      const pending = authRefreshClient.get('/auth-refresh-cancel', {
        signal: controller.signal
      })

      await Promise.resolve()
      controller.abort('stress refresh cancellation')
      await pending.catch(assertAbortError)
    },
    verify() {
      assert(authRefreshCalls > 0, 'Shared authentication refresh was not used')
    }
  },
  {
    name: 'asyncExtensionCancellation',
    weight: 100_000,
    operation: async index => {
      if ((index & 3) === 0) {
        const controller = new AbortController()
        const pending = authTokenCancellationClient.get('/auth-token-cancel', {
          signal: controller.signal
        })
        controller.abort('stress initial token cancellation')
        await pending.catch(assertAbortError)
        return
      }

      if ((index & 3) === 1) {
        const controller = new AbortController()
        const pending = cacheReadCancellationClient.get('/cache-read-cancel', {
          signal: controller.signal,
          extensions: { cache: { enabled: true } }
        })
        controller.abort('stress cache read cancellation')
        await pending.catch(assertAbortError)
        return
      }

      const signal = createSynchronousAbortSignal(
        'stress async policy cancellation'
      )

      if ((index & 3) === 2) {
        await retryPolicyCancellationClient.get('/retry-policy-cancel', {
          signal
        }).catch(assertAbortError)
        return
      }

      await circuitPolicyCancellationClient.get('/circuit-policy-cancel', {
        signal
      }).catch(assertExpectedCircuitFailure)
    },
    verify() {
      assert(
        authTokenCancellationCalls > 0,
        'Initial authentication token cancellation was not used'
      )
      assert(
        cacheReadCancellationCalls > 0,
        'Asynchronous cache read cancellation was not used'
      )
    }
  },
  {
    name: 'standardSchema',
    weight: 400_000,
    operation: () => schemaClient.get('/schema', { schema: stressSchema })
  },
  {
    name: 'errorsAndPreAbortedSignals',
    weight: 300_000,
    operation: async index => {
      if ((index & 1) === 0) {
        await errorClient.get('/error').catch(assertHttpError)
        return
      }

      const controller = new AbortController()
      controller.abort('already aborted')
      await bareClient.get('/abort', {
        signal: controller.signal
      }).catch(assertAbortError)
    }
  },
  {
    name: 'uploadFetchFormData',
    weight: 200_000,
    concurrency: Math.min(options.concurrency, 32),
    operation: () => uploadFetchClient.post('/upload-fetch', {
      extensions: {
        upload: { data: { name: 'npora', enabled: true } }
      }
    }),
    verify() {
      assert(uploadFetchCalls > 0, 'Fetch upload transport was not used')
    }
  },
  {
    name: 'uploadXhrProgress',
    weight: 100_000,
    concurrency: Math.min(options.concurrency, 32),
    operation: () => uploadXhrClient.post('/upload-xhr', {
      extensions: {
        upload: {
          data: { name: 'npora' },
          onProgress() {
            uploadXhrProgress += 1
          }
        }
      }
    }),
    verify() {
      assert(uploadXhrProgress > 0, 'XHR upload progress was not reported')
    }
  },
  {
    name: 'downloadFetchProgress',
    weight: 100_000,
    concurrency: Math.min(options.concurrency, 32),
    operation: async () => {
      const blob = await downloadFetchClient.get<Blob>('/download-fetch', {
        extensions: {
          download: {
            onProgress() {
              downloadFetchProgress += 1
            }
          }
        }
      })
      assert(blob.size === 5, 'Fetch download returned an invalid Blob')
    },
    verify() {
      assert(downloadFetchProgress > 0, 'Fetch download progress was not reported')
    }
  },
  {
    name: 'downloadXhrProgress',
    weight: 100_000,
    concurrency: Math.min(options.concurrency, 32),
    operation: async () => {
      const blob = await downloadXhrClient.get<Blob>('/download-xhr', {
        extensions: {
          download: {
            onProgress() {
              downloadXhrProgress += 1
            }
          }
        }
      })
      assert(blob.size === 5, 'XHR download returned an invalid Blob')
    },
    verify() {
      assert(downloadXhrProgress > 0, 'XHR download progress was not reported')
    }
  },
  {
    name: 'sseAndNdjsonStreams',
    weight: 100_000,
    concurrency: Math.min(options.concurrency, 16),
    operation: async index => {
      const path = (index & 1) === 0 ? '/events' : '/records'
      const values = await streamingClient.get<AsyncIterable<unknown>>(path)

      for await (const _value of values) {
        streamRecords += 1
      }
    },
    verify() {
      assert(streamRecords > 0, 'Streaming responses were not consumed')
    }
  },
  {
    name: 'mixedPluginPipeline',
    weight: 500_000,
    operation: () => mixedClient.get('/mixed')
  },
  {
    name: 'disabledPluginFastPaths',
    weight: 400_000,
    operation: () => disabledPluginClient.get('/disabled', {
      extensions: {
        cache: { enabled: false },
        concurrency: { enabled: false },
        circuitBreaker: { enabled: false },
        logger: { enabled: false }
      }
    })
  }
]

const counts = allocateOperations(options.operations, scenarios)
const results: Record<string, StressResult> = {}
let completed = 0
let totalFailures = 0
const startedAt = performance.now()

try {
  await warmUp()

  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index]!
    const operations = counts[index]!
    const result = await runStressScenario(
      operations,
      scenario.concurrency ?? options.concurrency,
      scenario.operation
    )

    await scenario.verify?.()
    results[scenario.name] = result
    completed += result.operations
    totalFailures += result.failures
    printScenario(scenario.name, result, completed, options.operations)
  }
} finally {
  globalThis.fetch = originalFetch

  if (originalXMLHttpRequest === undefined) {
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest
  } else {
    globalThis.XMLHttpRequest = originalXMLHttpRequest
  }
}

assert(completed === options.operations, 'Stress operation count mismatch')
assert(totalFailures === 0, `${totalFailures} unexpected stress failures`)

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch
  },
  configuration: {
    requestedOperations: options.operations,
    completedOperations: completed,
    concurrency: options.concurrency,
    warmup: options.warmup,
    latencySampleLimit: SAMPLE_LIMIT,
    forcedGarbageCollection: typeof globalThis.gc === 'function'
  },
  summary: {
    durationMs: performance.now() - startedAt,
    unexpectedFailures: totalFailures,
    adapterAttempts: {
      retries: retryAttempts,
      cacheDedupe: deferredAdapterAttempts
    },
    progressEvents: {
      uploadXhr: uploadXhrProgress,
      downloadFetch: downloadFetchProgress,
      downloadXhr: downloadXhrProgress
    },
    streamRecords
  },
  scenarios: results
}

console.log(`\nCompleted ${completed.toLocaleString('en-US')} logical operations with ${totalFailures} unexpected failures in ${(report.summary.durationMs / 1000).toFixed(2)}s.`)
await writeBenchmarkReport(options.output, report)

async function warmUp(): Promise<void> {
  await cacheHitClient.get('/cache', {
    extensions: { cache: { enabled: true, ttl: Infinity, key: 'hit' } }
  })

  for (let index = 0; index < options.warmup; index += 1) {
    await bareClient.get('/warmup')
    await concurrencyImmediateClient.get('/warmup')
    await circuitSuccessClient.get('/warmup')
    await mixedClient.get('/warmup')
  }
}

async function runStressScenario(
  operations: number,
  concurrency: number,
  operation: (index: number) => Promise<unknown>
): Promise<StressResult> {
  collectGarbage()
  const sampleStride = Math.max(1, Math.floor(operations / SAMPLE_LIMIT))
  const latencies: number[] = []
  const heapBefore = process.memoryUsage().heapUsed
  let peakRssBytes = process.memoryUsage().rss
  let nextOperation = 0
  let failures = 0
  let firstFailure: string | undefined
  const scenarioStartedAt = performance.now()

  const workers = Array.from(
    { length: Math.min(concurrency, operations) },
    async () => {
      while (true) {
        const index = nextOperation
        nextOperation += 1

        if (index >= operations) {
          return
        }

        const sampled = index % sampleStride === 0 && latencies.length < SAMPLE_LIMIT
        const operationStartedAt = sampled ? performance.now() : 0

        try {
          await operation(index)
        } catch (error) {
          failures += 1
          firstFailure ??= describeError(error)
        }

        if (sampled) {
          latencies.push(performance.now() - operationStartedAt)
        }

        if (index % 50_000 === 0) {
          peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
        }
      }
    }
  )

  await Promise.all(workers)
  const durationMs = performance.now() - scenarioStartedAt
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  collectGarbage()

  return {
    operations,
    durationMs,
    operationsPerSecond: operations / (durationMs / 1000),
    failures,
    ...(firstFailure === undefined ? {} : { firstFailure }),
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    peakRssBytes,
    latencySampleSize: latencies.length,
    latencyMs: summarizeLatencies(latencies)
  }
}

function collectGarbage(): void {
  globalThis.gc?.()
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = error instanceof RequestError ? ` [${error.code}]` : ''
    return `${error.name}${code}: ${error.message}`
  }

  return String(error)
}

function allocateOperations(
  total: number,
  definitions: readonly StressScenario[]
): number[] {
  const totalWeight = definitions.reduce((sum, scenario) => sum + scenario.weight, 0)
  const allocations = definitions.map(scenario =>
    Math.floor(total * scenario.weight / totalWeight)
  )
  let remainder = total - allocations.reduce((sum, value) => sum + value, 0)

  for (let index = 0; remainder > 0; index = (index + 1) % allocations.length) {
    allocations[index]! += 1
    remainder -= 1
  }

  return allocations
}

function summarizeLatencies(latencies: number[]): StressResult['latencyMs'] {
  const sorted = [...latencies].sort((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)

  return {
    mean: sorted.length === 0 ? 0 : total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0
  }
}

function percentile(sorted: number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index] ?? 0
}

function printScenario(
  name: string,
  result: StressResult,
  completedOperations: number,
  totalOperations: number
): void {
  console.log(
    `${name.padEnd(28)} ${result.operations.toLocaleString('en-US').padStart(10)} ops  ${result.operationsPerSecond.toFixed(0).padStart(9)} ops/s  p99 ${result.latencyMs.p99.toFixed(3).padStart(8)} ms  failures ${result.failures}  total ${completedOperations.toLocaleString('en-US')}/${totalOperations.toLocaleString('en-US')}`
  )

  if (result.firstFailure) {
    console.log(`  first failure: ${result.firstFailure}`)
  }
}

function createStableAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      return createResponse<T>(config)
    }
  }
}

function createDeferredAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      deferredAdapterAttempts += 1
      await Promise.resolve()
      return createResponse<T>(config)
    }
  }
}

function createMicrotaskAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      await Promise.resolve()
      return createResponse<T>(config)
    }
  }
}

function createAlternatingAdapter(): Adapter {
  let fail = true

  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      fail = !fail

      if (fail) {
        throw new RequestError('stress circuit failure', {
          code: 'NETWORK_ERROR',
          config
        })
      }

      return createResponse<T>(config)
    }
  }
}

function createAsyncCircuitFailureAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      asyncCircuitAttempts += 1
      throw new RequestError('stress async circuit failure', {
        code: 'NETWORK_ERROR',
        config
      })
    }
  }
}

function createAuthRefreshAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      const authorization = new Headers(config.headers).get('authorization')

      if (authorization !== 'Bearer refreshed-stress-token') {
        throw new RequestError('stress authentication failure', {
          code: 'HTTP_ERROR',
          status: 401,
          config
        })
      }

      return createResponse<T>(config)
    }
  }
}

function createRetryAdapter(): Adapter {
  const attempted = new WeakSet<RequestConfig>()

  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      retryAttempts += 1

      if (!attempted.has(config)) {
        attempted.add(config)
        throw new RequestError('stress retry', {
          code: 'NETWORK_ERROR',
          config
        })
      }

      attempted.delete(config)
      return createResponse<T>(config)
    }
  }
}

function createAlwaysFailingAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      throw new RequestError('stress async policy failure', {
        code: 'NETWORK_ERROR',
        config
      })
    }
  }
}

function createErrorAdapter(): Adapter {
  return {
    async request<T>(config: RequestConfig): Promise<NporaResponse<T>> {
      throw new RequestError('stress HTTP failure', {
        code: 'HTTP_ERROR',
        status: 503,
        config
      })
    }
  }
}

function createSynchronousAbortSignal(reason: unknown): AbortSignal {
  let aborted = false

  return {
    get aborted() {
      return aborted
    },
    get reason() {
      return aborted ? reason : undefined
    },
    addEventListener(_type: string, listener: EventListener) {
      aborted = true
      listener(new Event('abort'))
    },
    removeEventListener() {}
  } as unknown as AbortSignal
}

function createResponse<T>(config: RequestConfig): NporaResponse<T> {
  return {
    data: { ok: true } as T,
    status: 200,
    statusText: 'OK',
    headers: EMPTY_HEADERS,
    config,
    raw: EMPTY_RAW_RESPONSE
  }
}

function lifecyclePlugin(): Plugin {
  return {
    name: 'stress-lifecycle',
    install({ interceptors, hooks }) {
      interceptors.request.use(config => config)
      hooks.onRequest(() => {})
      hooks.onTransport(() => {})
      hooks.onResponse(() => {})
      hooks.onSettled(() => {})
      interceptors.response.use(response => response)
    }
  }
}

function createFetchResponse(url: string): Response {
  if (url.includes('/upload-fetch')) {
    uploadFetchCalls += 1
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  if (url.includes('/download-fetch')) {
    return new Response(textEncoder.encode('npora'), {
      status: 200,
      headers: {
        'content-length': '5',
        'content-type': 'application/octet-stream'
      }
    })
  }

  if (url.includes('/events')) {
    return new Response('id: 1\ndata: npora\n\n', {
      headers: { 'content-type': 'text/event-stream' }
    })
  }

  if (url.includes('/records')) {
    return new Response('{"id":1}\n{"id":2}\n', {
      headers: { 'content-type': 'application/x-ndjson' }
    })
  }

  return new Response('{"ok":true}', {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function progressEvent(loaded: number, total: number): ProgressEvent<EventTarget> {
  return {
    loaded,
    total,
    lengthComputable: true
  } as ProgressEvent<EventTarget>
}

function assertAbortError(error: unknown): void {
  assertRequestErrorCode(error, 'ABORT_ERROR')
}

function assertHttpError(error: unknown): void {
  assertRequestErrorCode(error, 'HTTP_ERROR')
}

function assertExpectedCircuitFailure(error: unknown): void {
  if (!(error instanceof RequestError)) {
    throw error
  }

  if (error.code !== 'NETWORK_ERROR' && error.code !== 'CIRCUIT_OPEN') {
    throw error
  }
}

function assertRequestErrorCode(error: unknown, code: string): void {
  if (!(error instanceof RequestError) || error.code !== code) {
    throw error
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
