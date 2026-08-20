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
  'CacheOptions',
  'CachePlugin',
  'CachePluginOptions',
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
  'FetchOptions',
  'HttpMethod',
  'Interceptor',
  'InterceptorManager',
  'InterceptorOptions',
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
  'Plugin',
  'PluginCleanup',
  'PluginContext',
  'PluginError',
  'PluginErrorCode',
  'PluginErrorOptions',
  'PluginHookManager',
  'PluginInterceptorManager',
  'QueryParams',
  'QueryValue',
  'RequestConfig',
  'RequestError',
  'RequestErrorCode',
  'RequestErrorOptions',
  'RequestExtensions',
  'RequestLogEntry',
  'RequestLogger',
  'ResponseLogEntry',
  'ResponseType',
  'SchemaValidationError',
  'ServerSentEvent',
  'StandardSchemaV1',
  'TransferProgress',
  'RetryEvent',
  'RetryOptions',
  'UploadData',
  'UploadOptions',
  'UploadProgress',
  'authPlugin',
  'cachePlugin',
  'circuitBreakerPlugin',
  'concurrencyPlugin',
  'createClient',
  'downloadPlugin',
  'loggerPlugin',
  'retryPlugin',
  'uploadPlugin'
].sort()

const runtimeExports = [
  'Client',
  'FetchAdapter',
  'InterceptorManager',
  'MemoryCacheStore',
  'MockAdapter',
  'PluginError',
  'RequestError',
  'SchemaValidationError',
  'authPlugin',
  'cachePlugin',
  'circuitBreakerPlugin',
  'concurrencyPlugin',
  'createClient',
  'downloadPlugin',
  'loggerPlugin',
  'retryPlugin',
  'uploadPlugin'
].sort()

const module = await import(
  new URL('../../dist/index.js', import.meta.url).href
)
const require = createRequire(import.meta.url)
const commonJSModule = require('../../dist/index.cjs')

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
