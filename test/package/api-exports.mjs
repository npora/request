import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'

const publicExports = [
  'Adapter',
  'AuthOptions',
  'AuthPluginOptions',
  'AuthTokenStorage',
  'CacheEntry',
  'CacheEvent',
  'CacheEventType',
  'CacheOptions',
  'CachePlugin',
  'CachePluginOptions',
  'CacheRefreshLease',
  'CacheSetOptions',
  'CacheStats',
  'CacheStore',
  'CircuitBreakerOptions',
  'CircuitBreakerPlugin',
  'CircuitBreakerPluginOptions',
  'CircuitBreakerStateChange',
  'CircuitState',
  'ConcurrencyOptions',
  'ConcurrencyPlugin',
  'ConcurrencyPluginOptions',
  'ConcurrencyState',
  'Client',
  'ClientOptions',
  'DownloadOptions',
  'DownloadOutput',
  'DownloadPluginOptions',
  'DownloadProgress',
  'DownloadTransport',
  'ErrorLogEntry',
  'FetchAdapter',
  'FetchFunction',
  'FetchOptions',
  'HttpMethod',
  'IndexedDBCacheCompactionOptions',
  'IndexedDBCacheCompactionResult',
  'IndexedDBCacheStore',
  'IndexedDBCacheStoreEvent',
  'IndexedDBCacheStoreOptions',
  'IndexedDBCacheUsage',
  'Interceptor',
  'InterceptorManager',
  'InterceptorOptions',
  'JsonParser',
  'JsonParserContext',
  'JsonStringifier',
  'LoggerOptions',
  'LoggerEntry',
  'MemoryCacheStore',
  'MemoryCacheStoreOptions',
  'MockAdapter',
  'MockAdapterOptions',
  'MockHandler',
  'MockReply',
  'MockReplyHandler',
  'MockRequestMatcher',
  'MockResponseOptions',
  'MockRoute',
  'MockURLMatcher',
  'NporaResponse',
  'OpenTelemetryAttributeValue',
  'OpenTelemetryContextApi',
  'OpenTelemetryHeaderSetter',
  'OpenTelemetryOptions',
  'OpenTelemetryPluginOptions',
  'OpenTelemetryPropagationApi',
  'OpenTelemetrySpan',
  'OpenTelemetryTraceApi',
  'OpenTelemetryTracer',
  'Plugin',
  'PluginCleanup',
  'PluginContext',
  'PluginError',
  'PluginErrorCode',
  'PluginErrorOptions',
  'PluginHookManager',
  'PluginInterceptorManager',
  'QueryParams',
  'QuerySerializer',
  'QueryValue',
  'RateLimitOptions',
  'RateLimitPlugin',
  'RateLimitPluginOptions',
  'RateLimitState',
  'RequestConfig',
  'RequestError',
  'RequestErrorCode',
  'RequestErrorOptions',
  'RequestExtensions',
  'RequestInputConfig',
  'RequestLogEntry',
  'RequestLogger',
  'RequestURL',
  'ResponseLogEntry',
  'ResponseType',
  'SchemaValidationError',
  'ServerSentEvent',
  'StandardSchemaV1',
  'StreamingSchemaLocation',
  'TieredCacheStore',
  'TieredCacheBroadcastOptions',
  'TieredCacheCoordinationOptions',
  'TieredCacheStoreOptions',
  'TransferProgress',
  'RetryEvent',
  'RetryOptions',
  'UploadData',
  'UploadOptions',
  'UploadProgress',
  'WebStorageCacheStore',
  'WebStorageCacheStoreOptions',
  'authPlugin',
  'cachePlugin',
  'circuitBreakerPlugin',
  'concurrencyPlugin',
  'createClient',
  'downloadPlugin',
  'isRequestError',
  'isSchemaValidationError',
  'loggerPlugin',
  'openTelemetryPlugin',
  'rateLimitPlugin',
  'retryPlugin',
  'uploadPlugin'
].sort()

const runtimeExports = [
  'Client',
  'FetchAdapter',
  'InterceptorManager',
  'IndexedDBCacheStore',
  'MemoryCacheStore',
  'MockAdapter',
  'PluginError',
  'RequestError',
  'SchemaValidationError',
  'TieredCacheStore',
  'WebStorageCacheStore',
  'authPlugin',
  'cachePlugin',
  'circuitBreakerPlugin',
  'concurrencyPlugin',
  'createClient',
  'downloadPlugin',
  'isRequestError',
  'isSchemaValidationError',
  'loggerPlugin',
  'openTelemetryPlugin',
  'rateLimitPlugin',
  'retryPlugin',
  'uploadPlugin'
].sort()

const module = await import(
  new URL('../../dist/index.js', import.meta.url).href
)
const require = createRequire(import.meta.url)
const commonJSModule = require('../../dist/index.cjs')

const subpathRuntimeExports = {
  core: [
    'Client',
    'FetchAdapter',
    'InterceptorManager',
    'PluginError',
    'RequestError',
    'SchemaValidationError',
    'createClient',
    'isRequestError',
    'isSchemaValidationError'
  ],
  plugins: [
    'IndexedDBCacheStore',
    'MemoryCacheStore',
    'PluginError',
    'TieredCacheStore',
    'WebStorageCacheStore',
    'authPlugin',
    'cachePlugin',
    'circuitBreakerPlugin',
    'concurrencyPlugin',
    'downloadPlugin',
    'loggerPlugin',
    'openTelemetryPlugin',
    'rateLimitPlugin',
    'retryPlugin',
    'uploadPlugin'
  ],
  'plugins/cache': [
    'IndexedDBCacheStore',
    'MemoryCacheStore',
    'TieredCacheStore',
    'WebStorageCacheStore',
    'cachePlugin'
  ],
  'plugins/retry': ['retryPlugin'],
  'plugins/rate-limit': ['rateLimitPlugin'],
  'plugins/opentelemetry': ['openTelemetryPlugin'],
  testing: ['MockAdapter']
}

for (const [path, exports] of Object.entries(subpathRuntimeExports)) {
  const esm = await import(
    new URL(`../../dist/${path}.js`, import.meta.url).href
  )
  const cjs = require(`../../dist/${path}.cjs`)

  assert.deepEqual(Object.keys(esm).sort(), exports.sort())
  assert.deepEqual(Object.keys(cjs).sort(), exports.sort())
}

assert.deepEqual(
  Object.keys(module).sort(),
  runtimeExports,
  'Runtime exports changed. Update the public API contract intentionally.'
)

for (const packageModule of [module, commonJSModule]) {
  for (const exportName of runtimeExports) {
    const exported = packageModule[exportName]

    if (typeof exported === 'function' && /^[A-Z]/.test(exportName)) {
      assert.equal(
        exported.name,
        exportName,
        `Exported constructor name changed for ${exportName}.`
      )
    }
  }
}

const declarationPath = fileURLToPath(
  new URL('../../dist/index.d.ts', import.meta.url)
)
const program = ts.createProgram([declarationPath], {
  noEmit: true,
  skipLibCheck: true
})
const source = program.getSourceFile(declarationPath)

assert.ok(source, 'Built declaration entry was not found.')

const checker = program.getTypeChecker()
const moduleSymbol = checker.getSymbolAtLocation(source)

assert.ok(moduleSymbol, 'Built declaration entry is not a module.')

const typeExports = checker
  .getExportsOfModule(moduleSymbol)
  .map(symbol => symbol.name)
  .sort()

assert.deepEqual(
  typeExports,
  publicExports,
  'Type exports changed. Update the public API contract intentionally.'
)
