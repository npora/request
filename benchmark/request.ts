import {
  authPlugin,
  cachePlugin,
  circuitBreakerPlugin,
  concurrencyPlugin,
  createClient,
  loggerPlugin,
  RequestError,
  retryPlugin,
  type Adapter,
  type NporaResponse,
  type Plugin,
  type RequestConfig
} from '../src'
import {
  parseBenchmarkOptions,
  printBenchmarkReport,
  runConcurrent,
  runSequential,
  writeBenchmarkReport
} from './harness'

const options = parseBenchmarkOptions(
  process.argv.slice(2),
  {
    operations: 5000,
    concurrency: 50,
    warmup: 250
  }
)
const adapter = createBenchmarkAdapter()
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
const bareRequestConfig: RequestConfig = {
  url: '/benchmark',
  method: 'GET'
}
const client = createClient({
  adapter,
  headers: {
    'x-client': 'npora'
  }
})
const bareClient = createClient({ adapter })
const pipelineClient = createClient({
  adapter
}).use(createBenchmarkPlugin())
const cacheClient = createClient({
  adapter
}).use(cachePlugin())
const cachePrimitiveClient = createClient({
  adapter: createPrimitiveBenchmarkAdapter()
}).use(cachePlugin())
const cacheMissClient = createClient({
  adapter
}).use(cachePlugin())
const concurrencyClient = createClient({
  adapter
}).use(concurrencyPlugin())
const circuitBreakerClient = createClient({
  adapter
}).use(circuitBreakerPlugin())
const concurrencyBaseClient = createClient({
  adapter,
  baseURL: 'https://benchmark.example.com'
}).use(concurrencyPlugin())
const circuitBreakerBaseClient = createClient({
  adapter,
  baseURL: 'https://benchmark.example.com'
}).use(circuitBreakerPlugin())
const authStaticTokenClient = createClient({
  adapter
}).use(authPlugin({
  token: 'benchmark-token'
}))
const retryOnceClient = createClient({
  adapter: createRetryBenchmarkAdapter()
}).use(retryPlugin({
  retries: 1,
  delay: 0
}))
const httpErrorClient = createClient({
  adapter: createErrorBenchmarkAdapter(500)
})
const loggerNoopClient = createClient({
  adapter
}).use(loggerPlugin({
  logger: {
    info() {},
    error() {}
  }
}))
const authNonRefreshErrorClient = createClient({
  adapter: createErrorBenchmarkAdapter(403)
}).use(authPlugin({
  token: 'benchmark-token',
  refreshToken: () => 'unused-token'
}))
const cachedRequestConfig: RequestConfig = {
  url: '/benchmark-cache',
  method: 'GET',
  extensions: {
    cache: {
      enabled: true,
      ttl: Number.POSITIVE_INFINITY
    }
  }
}
const cacheMissRequestConfig: RequestConfig = {
  url: '/benchmark-cache-miss',
  method: 'GET',
  extensions: {
    cache: {
      enabled: true,
      ttl: 0
    }
  }
}
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
const bareSequential = await runSequential(
  options.operations,
  () => bareClient.get('/benchmark')
)
const sequentialPluginPipeline = await runSequential(
  options.operations,
  () => pipelineClient.get('/benchmark', requestConfig)
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
const cacheHitClient = await runSequential(
  options.operations,
  () => cacheClient.get('/benchmark-cache', cachedRequestConfig)
)
const cachePrimitiveHitClient = await runSequential(
  options.operations,
  () => cachePrimitiveClient.get('/benchmark-cache', cachedRequestConfig)
)
const cacheMissClientResult = await runSequential(
  options.operations,
  () => cacheMissClient.get('/benchmark-cache-miss', cacheMissRequestConfig)
)
const concurrencyImmediateClient = await runSequential(
  options.operations,
  () => concurrencyClient.get('/benchmark', requestConfig)
)
const circuitBreakerSuccessClient = await runSequential(
  options.operations,
  () => circuitBreakerClient.get('/benchmark', requestConfig)
)
const concurrencyBaseClientResult = await runSequential(
  options.operations,
  () => concurrencyBaseClient.get('/benchmark', requestConfig)
)
const circuitBreakerBaseClientResult = await runSequential(
  options.operations,
  () => circuitBreakerBaseClient.get('/benchmark', requestConfig)
)
const authStaticTokenClientResult = await runSequential(
  options.operations,
  () => authStaticTokenClient.get('/benchmark', requestConfig)
)
const authBareTokenClientResult = await runSequential(
  options.operations,
  () => authStaticTokenClient.get('/benchmark', bareRequestConfig)
)
const retryOnceClientResult = await runSequential(
  options.operations,
  () => retryOnceClient.get('/benchmark', requestConfig)
)
const httpErrorClientResult = await runSequential(
  options.operations,
  () => httpErrorClient.get('/benchmark', requestConfig)
    .catch(ignoreBenchmarkError)
)
const loggerNoopClientResult = await runSequential(
  options.operations,
  () => loggerNoopClient.get('/benchmark', requestConfig)
)
const loggerSensitiveQueryClientResult = await runSequential(
  options.operations,
  () => loggerNoopClient.get(
    '/benchmark?token=secret&mode=benchmark',
    requestConfig
  )
)
const authNonRefreshErrorClientResult = await runSequential(
  options.operations,
  () => authNonRefreshErrorClient.get('/benchmark', requestConfig)
    .catch(ignoreBenchmarkError)
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
const fetchAdapterAutoTextClient = await runSequential(
  options.operations,
  () => fetchClient.get('/benchmark')
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
const fetchAdapterBoundedClient = await runSequential(
  options.operations,
  () => fetchClient.get('/benchmark', {
    maxResponseSize: 1024,
    responseType: 'text'
  })
)
const fetchAdapterQueryClient = await runSequential(
  options.operations,
  () => fetchClient.get('/benchmark#result', {
    query: {
      page: 2,
      search: 'hello world',
      tag: ['request', 'benchmark'],
      ignored: null
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
    bareSequentialClient: bareSequential,
    sequentialPluginPipeline,
    concurrentClient: concurrent,
    concurrentPluginPipeline: pluginPipeline,
    cacheHitClient,
    cachePrimitiveHitClient,
    cacheMissClient: cacheMissClientResult,
    concurrencyImmediateClient,
    circuitBreakerSuccessClient,
    concurrencyBaseClient: concurrencyBaseClientResult,
    circuitBreakerBaseClient: circuitBreakerBaseClientResult,
    authStaticTokenClient: authStaticTokenClientResult,
    authBareTokenClient: authBareTokenClientResult,
    retryOnceClient: retryOnceClientResult,
    httpErrorClient: httpErrorClientResult,
    loggerNoopClient: loggerNoopClientResult,
    loggerSensitiveQueryClient: loggerSensitiveQueryClientResult,
    authNonRefreshErrorClient: authNonRefreshErrorClientResult,
    fetchAdapterClient,
    fetchAdapterAutoTextClient,
    fetchAdapterCompleteResponse,
    fetchAdapterBoundedClient,
    fetchAdapterQueryClient
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

printBenchmarkReport(report.scenarios)
await writeBenchmarkReport(options.output, report)

async function warmUp(iterations: number): Promise<void> {
  await cacheClient.get('/benchmark-cache', cachedRequestConfig)
  await cachePrimitiveClient.get('/benchmark-cache', cachedRequestConfig)

  for (let index = 0; index < iterations; index += 1) {
    await client.get('/benchmark', requestConfig)
    await bareClient.get('/benchmark')
    await pipelineClient.get('/benchmark', requestConfig)
    await concurrencyClient.get('/benchmark', requestConfig)
    await circuitBreakerClient.get('/benchmark', requestConfig)
    await concurrencyBaseClient.get('/benchmark', requestConfig)
    await circuitBreakerBaseClient.get('/benchmark', requestConfig)
    await authStaticTokenClient.get('/benchmark', requestConfig)
    await authStaticTokenClient.get('/benchmark', bareRequestConfig)
    await httpErrorClient.get('/benchmark', requestConfig)
      .catch(ignoreBenchmarkError)
    await loggerNoopClient.get('/benchmark', requestConfig)
    await loggerNoopClient.get(
      '/benchmark?token=secret&mode=benchmark',
      requestConfig
    )
    await fetchClient.get('/benchmark', {
      responseType: 'text'
    })
    await fetchClient.get('/benchmark')
  }
}

function createRetryBenchmarkAdapter(): Adapter {
  let attempts = 0

  return {
    async request<T>(
      config: RequestConfig
    ): Promise<NporaResponse<T>> {
      attempts += 1

      if (attempts % 2 === 1) {
        throw new RequestError('benchmark retry', {
          code: 'NETWORK_ERROR',
          config
        })
      }

      return createBenchmarkResponse<T>(config)
    }
  }
}

function createErrorBenchmarkAdapter(status: number): Adapter {
  return {
    async request<T>(
      config: RequestConfig
    ): Promise<NporaResponse<T>> {
      throw new RequestError('benchmark error', {
        code: 'HTTP_ERROR',
        status,
        config
      })
    }
  }
}

function ignoreBenchmarkError(): void {}

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

function createBenchmarkAdapter(): Adapter {
  return {
    async request<T>(
      config: RequestConfig
    ): Promise<NporaResponse<T>> {
      return createBenchmarkResponse<T>(config)
    }
  }
}

function createPrimitiveBenchmarkAdapter(): Adapter {
  return {
    async request<T>(
      config: RequestConfig
    ): Promise<NporaResponse<T>> {
      return {
        ...createBenchmarkResponse<T>(config),
        data: 'benchmark' as T
      }
    }
  }
}

function createBenchmarkResponse<T>(
  config: RequestConfig
): NporaResponse<T> {
  return {
    data: {
      ok: true,
      id: config.query?.id
    } as T,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config,
    raw: new Response(null, {
      status: 200
    })
  }
}
