import {
  createClient,
  MockAdapter,
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
    fetchAdapterClient,
    fetchAdapterCompleteResponse,
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
  for (let index = 0; index < iterations; index += 1) {
    await client.get('/benchmark', requestConfig)
    await pipelineClient.get('/benchmark', requestConfig)
    await fetchClient.get('/benchmark', {
      responseType: 'text'
    })
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
