import {
  defineConfig,
  devices
} from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './tests',

  testMatch: '**/*.spec.ts',

  fullyParallel: false,

  forbidOnly: Boolean(process.env.CI),

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: [
    ['list'],

    [
      'html',
      {
        open: 'never',
        outputFolder:
          fileURLToPath(new URL('../.artifacts/playwright-report', import.meta.url))
      }
    ]
  ],

  use: {
    baseURL:
      'http://localhost:4173',

    trace: 'on-first-retry',

    screenshot: 'only-on-failure',

    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'chromium',

      use: {
        ...devices['Desktop Chrome']
      }
    },

    {
      name: 'firefox',

      use: {
        ...devices['Desktop Firefox']
      }
    },

    {
      name: 'webkit',

      use: {
        ...devices['Desktop Safari']
      }
    }
  ],

  webServer: {
    command:
      'pnpm --dir .. build && node server.mjs',

    url:
      'http://localhost:4173',

    reuseExistingServer:
      !process.env.CI,

    timeout: 120_000,

    stdout: 'pipe',

    stderr: 'pipe'
  },

  outputDir: fileURLToPath(new URL('../.artifacts/test-results', import.meta.url))
})
