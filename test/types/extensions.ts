import type {
  Client,
  CacheStore,
  CircuitBreakerPlugin,
  CircuitBreakerPluginOptions,
  CircuitBreakerStateChange,
  CircuitState,
  ConcurrencyPlugin,
  ConcurrencyPluginOptions,
  ConcurrencyState,
  DownloadOutput,
  DownloadPluginOptions,
  LoggerEntry,
  MemoryCacheStoreOptions,
  Plugin,
  RequestLogger,
  RequestConfig,
  ServerSentEvent,
  TransferProgress,
  RetryEvent,
  RetryOptions,
  UploadProgress
} from '@npora/request'
import {
  circuitBreakerPlugin,
  concurrencyPlugin,
  downloadPlugin,
  MemoryCacheStore
} from '@npora/request'

interface MetricsOptions {
  enabled?: boolean

  sampleRate?: number
}

declare module '@npora/request' {
  interface RequestExtensions {
    metrics?: MetricsOptions
  }
}

const retry: RetryOptions = {
  retries: 2,
  delay: 100,
  jitter(event) {
    return event.delay / 2
  },
  maxElapsedTime: 5000,
  onRetry(event) {
    const retryEvent: RetryEvent = event

    void retryEvent.attempt
  }
}

const config: RequestConfig = {
  url: '/user',
  searchParams: new URLSearchParams([
    ['tag', 'first'],
    ['tag', 'second']
  ]),
  extensions: {
    retry,
    cache: {
      enabled: true
    },
    circuitBreaker: {
      key: 'primary-api'
    },
    concurrency: {
      key: 'primary-api',
      queueTimeout: 1000
    },
    metrics: {
      enabled: true,
      sampleRate: 0.5
    }
  }
}

void config

type LegacyExtensionKey =
  | 'auth'
  | 'cache'
  | 'download'
  | 'logger'
  | 'retry'
  | 'upload'

type HasNoLegacyExtensionKeys =
  Extract<keyof RequestConfig, LegacyExtensionKey> extends never
    ? true
    : false

const hasNoLegacyExtensionKeys: HasNoLegacyExtensionKeys = true

void hasNoLegacyExtensionKeys

const plugin: Plugin = {
  name: 'metrics',
  priority: 10,
  requires: ['logger'],
  conflicts: ['legacy-metrics'],

  install({ hooks }) {
    hooks.onRequest(() => {})
    hooks.onSettled(() => {})

    return () => {}
  }
}

declare const client: Client

client.use(plugin)
client.unuse(plugin.name)

const installed: boolean = client.hasPlugin(plugin.name)
const extended: Client = client.extend({
  baseURL: '/v2',
  headers: {
    'x-client': 'extended'
  }
})
const headData: Promise<void> = client.head('/health')
const optionsData: Promise<{ allowed: boolean }> = client.options<{
  allowed: boolean
}>('/resource')

void installed
void extended
void headData
void optionsData

const downloadOptions: DownloadPluginOptions = {
  transport: 'xhr'
}

client.use(downloadPlugin(downloadOptions))

const downloadOutput: DownloadOutput = 'stream'
const streamingDownload: Promise<ReadableStream<Uint8Array>> = client.get<
  ReadableStream<Uint8Array>
>('/archive', {
  extensions: {
    download: {
      output: downloadOutput,
      onProgress(progress) {
        void progress.loaded
      }
    }
  }
})

void streamingDownload

const uploadProgress = (progress: UploadProgress) => {
  const transfer: TransferProgress = progress

  return (transfer.bytes ?? 0) + (transfer.rate ?? 0)
}

const legacyUploadProgress: UploadProgress = {
  loaded: 1,
  total: 2,
  progress: 0.5
}

void uploadProgress
void legacyUploadProgress

const logger: RequestLogger = {
  info(_message, entry) {
    const lifecycle: LoggerEntry = entry

    void lifecycle.requestId
    void lifecycle.timestamp
  },

  error(_message, entry) {
    const lifecycle: LoggerEntry = entry

    void lifecycle.duration
    void lifecycle.attempt
  }
}

const loggerConfig: RequestConfig = {
  url: '/observed',
  extensions: {
    logger: {
      logger,
      createRequestId: () => 'request-id'
    }
  }
}

void loggerConfig

const eventStream: Promise<AsyncIterable<ServerSentEvent>> = client.sse(
  '/events'
)
const jsonLines: Promise<AsyncIterable<{ id: number }>> = client.ndjson<{
  id: number
}>('/records')

void eventStream
void jsonLines

const cacheStore: CacheStore = {
  async get(_key) {
    return undefined
  },
  async set(_key, _entry) {},
  async delete(_key) {},
  async clear() {}
}

void cacheStore

const memoryCacheOptions: MemoryCacheStoreOptions = {
  maxEntries: 100
}
const memoryCacheStore: CacheStore = new MemoryCacheStore(memoryCacheOptions)

void memoryCacheStore

const circuitOptions: CircuitBreakerPluginOptions = {
  failureThreshold: 3,
  maxCircuits: 100,
  resetTimeout: 10000,
  shouldCountFailure(error, requestConfig) {
    void error
    return requestConfig.method === 'GET'
  },
  onStateChange(event) {
    const change: CircuitBreakerStateChange = event
    const state: CircuitState = change.state

    void state
  }
}

const breaker: CircuitBreakerPlugin = circuitBreakerPlugin(circuitOptions)
const circuitState: CircuitState = breaker.getState('primary-api')

breaker.reset('primary-api')
breaker.reset()

void circuitState

const concurrencyOptions: ConcurrencyPluginOptions = {
  maxConcurrent: 10,
  maxQueue: 100,
  queueTimeout: 5000,
  maxKeys: 1000,
  createKey(requestConfig) {
    return requestConfig.baseURL ?? 'default'
  }
}
const concurrency: ConcurrencyPlugin = concurrencyPlugin(
  concurrencyOptions
)
const concurrencyState: Readonly<ConcurrencyState> =
  concurrency.getState('primary-api')

void concurrencyState
