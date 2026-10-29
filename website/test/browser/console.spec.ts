import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))

test('all ten real scenarios complete and report actual network activity', async ({ page }, testInfo) => {
  const errors: string[] = []
  const retryUrls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/retry') retryUrls.push(request.url()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('从容可控')
  await expect(page.locator('[data-version]')).toHaveText(version)
  const scenarios = ['get', 'schema', 'query', 'sse', 'ndjson', 'retry', 'timeout', 'transfer', 'auth', 'traffic']
  for (const id of scenarios) {
    await page.locator(`[data-scenario="${id}"]`).click()
    await page.getByRole('button', { name: '运行场景', exact: false }).click()
    await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'passed', { timeout: 30000 })
    const output = await page.locator('#output').innerText()
    if (id === 'schema') expect(output).toContain('SCHEMA_ERROR')
    if (id === 'retry') {
      const runs = retryUrls.map(url => new URL(url).searchParams.get('run'))
      expect(runs).toHaveLength(3)
      expect(runs[0]).toMatch(/^[a-f0-9-]{36}$/)
      expect(new Set(runs).size).toBe(1)
      await expect(page.locator('#requests tr')).toHaveCount(3)
      expect(await page.locator('#requests').innerText()).toMatch(/503[\s\S]*503[\s\S]*200/)
    }
    if (id === 'timeout') {
      await expect(page.locator('#requests tr')).toHaveCount(2)
      expect(output.match(/TIMEOUT_ERROR/g)).toHaveLength(2)
      expect(output).toContain('CIRCUIT_OPEN')
    }
    if (id === 'transfer') {
      expect((await page.locator('#requests').innerText()).match(/POST \/api\/upload/g)).toHaveLength(16)
      await expect(page.locator('#upload-progress')).toHaveAttribute('value', '1')
      await expect(page.locator('#download-progress')).toHaveAttribute('value', '1')
    }
    if (id === 'auth') {
      const requests = await page.locator('#requests').innerText()
      expect(requests.match(/POST \/api\/refresh/g)).toHaveLength(1)
      expect(requests.match(/401/g)).toHaveLength(2)
      expect(requests.match(/GET \/api\/auth/g)).toHaveLength(4)
    }
    if (id === 'traffic') {
      expect(output).toContain('RATE_LIMIT')
      const probe = await page.locator('#requests').innerText()
      expect(probe.match(/GET \/api\/traffic-probe/g)).toHaveLength(2)
      expect(probe).toMatch(/traffic-probe\s+429[\s\S]*traffic-probe\s+200/)
    }
  }
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('console-complete.png'), fullPage: true })
})

test('SSE renders before EOF, stops cleanly, and another scenario can run', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-scenario="sse"]').click()
  await page.locator('#run').click()
  await expect(page.locator('#output')).toContainText('Hello,')
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'running')
  await expect(page.locator('#stream-state')).toHaveText('OPEN')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'stopped')
  await expect(page.locator('#stream-state')).toHaveText('CLOSED')
  await page.locator('[data-scenario="get"]').click()
  await page.locator('#run').click()
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'passed')
})

test('stopping the full sequence prevents later scenarios from starting', async ({ page }) => {
  const later: string[] = []
  page.on('request', request => { if (request.url().includes('/api/ndjson')) later.push(request.url()) })
  await page.goto('/')
  await page.locator('#run-all').click()
  await expect(page.locator('[data-scenario="sse"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'running')
  await page.locator('#stop').click()
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'stopped')
  await expect(page.locator('#run-all')).toBeEnabled()
  await expect(page.locator('[data-scenario="sse"]')).toHaveAttribute('aria-pressed', 'true')
  expect(later).toEqual([])
})

test('responsive layout, keyboard access and source isolation', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('[data-scenario]')).toHaveCount(10)
  await expect(page.locator('.workspace')).toHaveCSS('display', 'grid')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const response = await page.request.get('/functions/api/user.js')
  expect(response.status()).toBe(404)
  const api = await page.request.get('/api/missing')
  expect(api.status()).toBe(404); expect(api.headers()['content-type']).toContain('application/json')
  const document = await page.request.get('/')
  expect(document.headers()['content-security-policy']).toContain("script-src 'self'")
  await page.screenshot({ path: testInfo.outputPath('homepage.png'), fullPage: true })
  // Safari's Tab-to-links behavior depends on OS keyboard preferences. Verify
  // keyboard activation without assuming the browser's initial focus policy.
  const skip = page.getByRole('link', { name: '跳到测试控制台' })
  await skip.focus()
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#playground$/)
})
