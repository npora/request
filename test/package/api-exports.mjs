import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
  'Client',
  'ClientOptions',
  'DownloadOptions',
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
  'MockAdapter',
  'MockAdapterOptions',
  'MockHandler',
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
  'RetryEvent',
  'RetryOptions',
  'UploadData',
  'UploadOptions',
  'UploadProgress',
  'authPlugin',
  'cachePlugin',
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
  'authPlugin',
  'cachePlugin',
  'createClient',
  'downloadPlugin',
  'loggerPlugin',
  'retryPlugin',
  'uploadPlugin'
].sort()

const module = await import(
  new URL('../../dist/index.js', import.meta.url).href
)

assert.deepEqual(
  Object.keys(module).sort(),
  runtimeExports,
  'Runtime exports changed. Update the public API contract intentionally.'
)

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
