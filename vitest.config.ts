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
        'src/types/**'
      ]
    }
  }
})
