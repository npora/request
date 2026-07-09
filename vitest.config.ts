import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      exclude: [
        'dist/**',
        'coverage/**',
        'examples/**',
        'test/**',
        '**/*.d.ts',
        'src/index.ts',
        'src/**/index.ts',
        'src/types/**',
        'src/plugins/Plugin.ts'
      ]
    }
  }
})
