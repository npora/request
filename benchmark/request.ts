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
const client = createClient({
  adapter,
  headers: {
    'x-client': 'npora'
  }
})
const pipelineClient = createClient({
  adapter
}).use(createBenchmarkPlugin())
const cacheClient = createClient({
  adapter
}).use(cachePlugin())
const concurrencyClient = createClient({
  adapter
}).use(concurrencyPlugin())
const circuitBreakerClient = createClient({
  adapter
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
const loggerNoopClient = createClient({
  adapter
}).use(loggerPlugin({
  logger: {
    info() {},
    error() {}
  }
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
const cacheHitClient = await runSequential(
  options.operations,
  () => cacheClient.get('/benchmark-cache', cachedRequestConfig)
)
const concurrencyImmediateClient = await runSequential(
  options.operations,
  () => concurrencyClient.get('/benchmark', requestConfig)
)
const circuitBreakerSuccessClient = await runSequential(
  options.operations,
  () => circuitBreakerClient.get('/benchmark', requestConfig)
)
const authStaticTokenClientResult = await runSequential(
  options.operations,
  () => authStaticTokenClient.get('/benchmark', requestConfig)
)
const retryOnceClientResult = await runSequential(
  options.operations,
  () => retryOnceClient.get('/benchmark', requestConfig)
)
const loggerNoopClientResult = await runSequential(
  options.operations,
  () => loggerNoopClient.get('/benchmark', requestConfig)
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
    concurrentClient: concurrent,
    concurrentPluginPipeline: pluginPipeline,
    cacheHitClient,
    concurrencyImmediateClient,
    circuitBreakerSuccessClient,
    authStaticTokenClient: authStaticTokenClientResult,
    retryOnceClient: retryOnceClientResult,
    loggerNoopClient: loggerNoopClientResult,
    fetchAdapterClient,
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

  for (let index = 0; index < iterations; index += 1) {
    await client.get('/benchmark', requestConfig)
    await pipelineClient.get('/benchmark', requestConfig)
    await concurrencyClient.get('/benchmark', requestConfig)
    await circuitBreakerClient.get('/benchmark', requestConfig)
    await authStaticTokenClient.get('/benchmark', requestConfig)
    await loggerNoopClient.get('/benchmark', requestConfig)
    await fetchClient.get('/benchmark', {
      responseType: 'text'
    })
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
