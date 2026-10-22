import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core-entry.ts',
    'schema-errors': 'src/schema-errors.ts',
    plugins: 'src/plugins/index.ts',
    'plugins/auth': 'src/plugins/authPlugin.ts',
    'plugins/cache': 'src/plugins/cachePlugin.ts',
    'plugins/memory-cache': 'src/plugins/memoryCachePlugin.ts',
    'plugins/circuit-breaker': 'src/plugins/circuitBreakerPlugin.ts',
    'plugins/concurrency': 'src/plugins/concurrencyPlugin.ts',
    'plugins/download': 'src/plugins/downloadPlugin.ts',
    'plugins/logger': 'src/plugins/loggerPlugin.ts',
    'plugins/opentelemetry': 'src/plugins/openTelemetryPlugin.ts',
    'plugins/opentelemetry-metrics': 'src/plugins/openTelemetryMetricsPlugin.ts',
    'plugins/rate-limit': 'src/plugins/rateLimitPlugin.ts',
    'plugins/retry': 'src/plugins/retryPlugin.ts',
    'plugins/upload': 'src/plugins/uploadPlugin.ts',
    testing: 'src/adapters/MockAdapter.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  minify: {
    compress: {
      keepNames: {
        class: true,
        function: false
      }
    },
    mangle: {
      keepNames: { class: true, function: false },
      // Keep the public API recognizable; internal helper bindings can shrink.
      reserved: [
        'createClient', 'isRequestError', 'isSchemaValidationError',
        'toFormErrors',
        'authPlugin', 'cachePlugin', 'memoryCachePlugin', 'circuitBreakerPlugin',
        'concurrencyPlugin', 'downloadPlugin', 'loggerPlugin',
        'openTelemetryPlugin', 'openTelemetryMetricsPlugin',
        'rateLimitPlugin', 'retryPlugin', 'uploadPlugin'
      ]
    }
  },
  clean: true,
  fixedExtension: false,
  target: 'es2020',
  outputOptions: {
    comments: false
  }
})
