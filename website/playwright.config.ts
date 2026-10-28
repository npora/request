import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false, workers: 1, forbidOnly: Boolean(process.env.CI),
  timeout: 60000, expect: { timeout: 30000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../.artifacts/website/browser-report', import.meta.url)) }]],
  outputDir: fileURLToPath(new URL('../.artifacts/website/browser-results', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:8787', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } }
  ],
  webServer: {
    command: 'npm run build && npm run dev', cwd: fileURLToPath(new URL('./', import.meta.url)),
    // Static HTML can be ready before the external DO binding has connected.
    url: 'http://127.0.0.1:8787/api/health', timeout: 120000, reuseExistingServer: false,
    stdout: 'pipe', stderr: 'pipe'
  }
})
