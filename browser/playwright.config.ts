import {
  defineConfig,
  devices
} from '@playwright/test'

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
          './playwright-report'
      }
    ]
  ],

  use: {
    baseURL:
      'http://127.0.0.1:4173',

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
      },

      launchOptions: {
        firefoxUserPrefs: {
          'network.proxy.type': 0,

          'network.proxy.no_proxies_on':
            'localhost, 127.0.0.1',

          'network.proxy.allow_hijacking_localhost':
            false
        }
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
      'http://127.0.0.1:4173',

    reuseExistingServer:
      !process.env.CI,

    timeout: 120_000,

    stdout: 'pipe',

    stderr: 'pipe'
  },

  outputDir: './test-results'
})
