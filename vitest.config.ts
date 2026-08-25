import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'test/**/*.test.ts'
    ],

    exclude: [
      'browser/**',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**'
    ],

    coverage: {
      provider: 'v8',

      reporter: [
        'text',
        'html',
        'lcov'
      ],

      reportsDirectory: './coverage',

      include: [
        'src/**/*.ts'
      ],

      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        // Exercised against real IndexedDB in the Playwright browser suite.
        'src/plugins/indexedDBCacheStore.ts',
        'src/types/**'
      ],

      thresholds: {
        statements: 85,
        branches: 80,
        functions: 90,
        lines: 85
      }
    }
  }
})
