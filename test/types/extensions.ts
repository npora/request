import type {
  Client,
  CacheEvent,
  CachePlugin,
  CachePluginOptions,
  CacheRefreshLease,
  CacheSetOptions,
  CacheStats,
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
  IndexedDBCacheCompactionOptions,
  IndexedDBCacheCompactionResult,
  IndexedDBCacheStoreEvent,
  IndexedDBCacheStoreOptions,
  IndexedDBCacheUsage,
  JsonParserContext,
  LoggerEntry,
  MemoryCacheStoreOptions,
  Plugin,
  RequestLogger,
  RequestConfig,
  ServerSentEvent,
  TieredCacheBroadcastOptions,
  TieredCacheCoordinationOptions,
  TieredCacheStoreOptions,
  TransferProgress,
  RetryEvent,
  RetryOptions,
  UploadProgress,
  WebStorageCacheStoreOptions
} from '@npora/request'
import {
  cachePlugin,
  circuitBreakerPlugin,
  concurrencyPlugin,
  downloadPlugin,
  IndexedDBCacheStore,
  isRequestError,
  isSchemaValidationError,
  MemoryCacheStore,
  TieredCacheStore,
  WebStorageCacheStore
} from '@npora/request'

declare const caught: unknown

if (isRequestError<{ message: string }>(caught)) {
  void caught.data?.message
}

if (isSchemaValidationError(caught)) {
  void caught.issues
  void caught.schemaVendor
}

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
  statusCodes: [409, 429, 503],
  retryOnTimeout: false,
  delay: 100,
  jitter(event) {
    return event.delay / 2
  },
  maxElapsedTime: 5000,
  shouldRetry(error) {
    return error instanceof TypeError ? true : undefined
  },
  onRetry(event) {
    const retryEvent: RetryEvent = event

    void retryEvent.attempt
  }
}

const config: RequestConfig = {
  url: '/user',
  allowAbsoluteUrls: false,
  totalTimeout: 5000,
  throwHttpErrors: false,
  maxRequestSize: 1024,
  removeHeaders: ['authorization'],
  context: {
    traceId: 'trace-1',
    operation: 'load-user'
  },
  fetch: globalThis.fetch,
  parseJson: async (text, context) => {
    const parserContext: JsonParserContext = context

    void parserContext.config.url
    void parserContext.response.status

    return JSON.parse(text)
  },
  stringifyJson: value => JSON.stringify(value),
  searchParams: new URLSearchParams([
    ['tag', 'first'],
    ['tag', 'second']
  ]),
  querySerializer: query => new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)])
  ).toString(),
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

const urlConfig: RequestConfig = {
  url: new URL('https://api.example.com/user')
}

void urlConfig

void config

const primitiveJsonConfigs: RequestConfig[] = [
  { url: '/string', method: 'POST', json: 'npora' },
  { url: '/number', method: 'POST', json: 42 },
  { url: '/boolean', method: 'POST', json: false },
  { url: '/null', method: 'POST', json: null },
  {
    url: '/bigint',
    method: 'POST',
    json: 42n,
    stringifyJson: value => String(value)
  }
]

void primitiveJsonConfigs

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
  allowAbsoluteUrls: false,
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

const staleCacheConfig: RequestConfig = {
  url: '/stale',
  extensions: {
    cache: {
      enabled: true,
      staleIfError: 5000,
      staleWhileRevalidate: 10000,
      tags: ['user:1', 'users'],
      invalidateTags: ['user-lists']
    }
  }
}

void cacheStore
void staleCacheConfig

const memoryCacheOptions: MemoryCacheStoreOptions = {
  maxEntries: 100
}
const memoryCacheStore: CacheStore = new MemoryCacheStore(memoryCacheOptions)
const webStorageOptions: WebStorageCacheStoreOptions = {
  namespace: 'type-test',
  maxEntries: 100
}
const webStorageCacheStore: CacheStore = new WebStorageCacheStore(
  localStorage,
  webStorageOptions
)
const indexedDBOptions: IndexedDBCacheStoreOptions = {
  databaseName: 'type-test',
  namespace: 'type-test',
  maxEntries: 100,
  maxBytes: 1024 * 1024,
  quotaRecovery: true,
  onEvent(event) {
    const cacheEvent: IndexedDBCacheStoreEvent = event

    void cacheEvent.estimatedBytes
  },
  shouldPersist(entry, estimatedBytes) {
    return entry.status === 200 && estimatedBytes < 512 * 1024
  },
  schemaVersion: 2
}
const indexedDBStore = new IndexedDBCacheStore(
  indexedDB,
  indexedDBOptions
)
const indexedDBCacheStore: CacheStore = indexedDBStore
const indexedDBUsage: Promise<IndexedDBCacheUsage> = indexedDBStore.getUsage()
const compactionOptions: IndexedDBCacheCompactionOptions = {
  expiredBefore: Date.now(),
  maxRemovals: 100
}
const compaction: Promise<IndexedDBCacheCompactionResult> =
  indexedDBStore.compact(compactionOptions)
const tieredCacheOptions: TieredCacheStoreOptions = {
  primary: memoryCacheStore,
  secondary: indexedDBCacheStore,
  broadcast: {
    channel: new BroadcastChannel('type-test'),
    maxTrackedKeys: 100
  },
  coordination: {
    locks: navigator.locks,
    namespace: 'type-test'
  }
}
const tieredBroadcastOptions: TieredCacheBroadcastOptions =
  tieredCacheOptions.broadcast!
const tieredCoordinationOptions: TieredCacheCoordinationOptions =
  tieredCacheOptions.coordination!
const cacheRefreshLease: Promise<CacheRefreshLease> =
  new TieredCacheStore(tieredCacheOptions)
    .acquireRefreshLease!('type-test')
const tieredCacheStore: CacheStore = new TieredCacheStore(tieredCacheOptions)

void memoryCacheStore
void webStorageCacheStore
void indexedDBCacheStore
void indexedDBUsage
void compaction
void tieredCacheStore
void tieredBroadcastOptions
void tieredCoordinationOptions
void cacheRefreshLease

const cacheOptions: CachePluginOptions = {
  onEvent(event) {
    const cacheEvent: CacheEvent = event

    void cacheEvent.type
    void cacheEvent.timestamp
  }
}
const observedCache: CachePlugin = cachePlugin(cacheOptions)
const cacheStats: Readonly<CacheStats> = observedCache.getStats()
const cacheSetOptions: CacheSetOptions = {
  ttl: Infinity,
  status: 200,
  statusText: 'OK',
  headers: { 'x-cache-source': 'seed' },
  tags: ['user:1']
}

observedCache.resetStats()
void observedCache.delete({
  url: '/observed-cache-entry',
  extensions: {
    cache: {
      key: 'observed-cache-entry'
    }
  }
})
const cacheWrite: void | Promise<void> = observedCache.set(
  { url: '/observed-cache-entry' },
  { id: 1 },
  cacheSetOptions
)
const cacheUpdate: boolean | Promise<boolean> = observedCache.update<{
  id: number
}>({ url: '/observed-cache-entry' }, value => ({
  id: value.id + 1
}))
const invalidatedTags: number | Promise<number> =
  observedCache.invalidateTags(['user:1', 'users'])

void invalidatedTags
void cacheWrite
void cacheUpdate
void cacheStats.backgroundRefreshErrors
void cacheStats.invalidations

const formDataResponseConfig: RequestConfig = {
  url: '/form-data',
  responseType: 'formData'
}

void formDataResponseConfig

const bytesResponseConfig: RequestConfig = {
  url: '/bytes',
  responseType: 'bytes'
}

void bytesResponseConfig

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
