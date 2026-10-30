import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))

test('all ten real scenarios complete and report actual network activity', async ({ page }, testInfo) => {
  const errors: string[] = []
  const retryUrls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/retry') retryUrls.push(request.url()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('under control')
  await expect(page.locator('[data-version]')).toHaveText(version)
  const scenarios = ['get', 'schema', 'query', 'sse', 'ndjson', 'retry', 'timeout', 'transfer', 'auth', 'traffic']
  for (const id of scenarios) {
    await page.locator(`[data-scenario="${id}"]`).click()
    expect(await page.locator('#demo-description').innerText()).not.toMatch(/\p{Script=Han}/u)
    expect(await page.locator('#demo-code').innerText()).not.toMatch(/\p{Script=Han}/u)
    await page.getByRole('button', { name: 'Run scenario', exact: false }).click()
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
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'stopped')
  await expect(page.locator('#stream-state')).toHaveText('CLOSED')
  await page.locator('[data-scenario="get"]').click()
  await page.locator('#run').click()
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'passed')
})

test('waiting for a response updates elapsed time without rebuilding unchanged console content', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/user', async route => { await pending; await route.continue() })
  await page.goto('/')
  await page.locator('#run').click()
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'running')
  await page.evaluate(() => {
    const audit = { mutations: 0 }
    ;(window as any).consoleAudit = audit
    const observer = new MutationObserver(records => { audit.mutations += records.length })
    for (const id of ['demo-code', 'output', 'requests', 'outcome', 'scenarios']) {
      observer.observe(document.getElementById(id)!, { subtree: true, childList: true, characterData: true, attributes: true })
    }
  })
  try {
    await expect.poll(async () => parseFloat(await page.locator('#elapsed').innerText())).toBeGreaterThanOrEqual(0.6)
    expect(await page.evaluate(() => (window as any).consoleAudit.mutations)).toBe(0)
  } finally { release() }
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'passed')
  await expect(page.locator('#requests tr')).toHaveCount(1)
})

test('leaving the page cancels the batch before the next scenario starts', async ({ page }) => {
  const later: string[] = []
  page.on('request', request => { if (request.url().includes('/api/ndjson')) later.push(request.url()) })
  await page.goto('/')
  await page.locator('#run-all').click()
  await expect(page.locator('[data-scenario="sse"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#stream-state')).toHaveText('OPEN')
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'stopped')
  await expect(page.locator('#run-all')).toBeEnabled()
  expect(later).toEqual([])
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
  const skip = page.getByRole('link', { name: 'Skip to playground' })
  await skip.focus()
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#playground$/)
})

test('language defaults to English and persists manual selection without losing results', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle('Npora Request · Every request, under control')
  await expect(page.locator('#demo-title')).toHaveText('Fetch typed data')
  await expect(page.locator('#demo-code')).not.toContainText('支持')
  await page.locator('#run').click()
  await expect(page.locator('#outcome')).toHaveText('Passed')
  const requests = await page.locator('#requests').innerText()
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('#demo-title')).toHaveText('标准数据获取')
  await expect(page.locator('#outcome')).toHaveText('验证通过')
  await expect(page.locator('#output')).toContainText('已验证预期行为')
  expect(await page.locator('#requests').innerText()).toBe(requests)
  await page.reload()
  await expect(page.locator('#language')).toHaveValue('zh-CN')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.locator('#language').selectOption('en')
  await page.locator('[data-scenario="sse"]').click()
  await page.locator('#run').click()
  await expect(page.locator('#stream-state')).toHaveText('OPEN')
  await page.locator('#language').selectOption('zh-CN')
  await expect(page.locator('#outcome')).toHaveAttribute('data-outcome', 'running')
  await page.locator('#stop').click()
  await expect(page.locator('#outcome')).toHaveText('已停止')
  await page.locator('#language').selectOption('en')
  await expect(page.locator('#outcome')).toHaveText('Stopped')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('language switching still works when storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('Storage blocked') } })
    Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Storage blocked') } })
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.locator('#language').selectOption('zh-CN')
  await expect(page.locator('#demo-title')).toHaveText('标准数据获取')
  await page.locator('[data-scenario="schema"]').click()
  await expect(page.locator('#demo-code')).toContainText('支持 Zod')
  await page.locator('#language').selectOption('en')
  await expect(page.locator('#demo-code')).toContainText('Supports Zod')
})

test('records a real response into a reusable fixture and preserves it across languages', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/user') requests.push(request.url()) })
  await page.goto('/')
  await expect(page.locator('#fixture-copy')).toBeDisabled()
  await page.locator('#fixture-run').click()
  await expect(page.locator('#fixture-status')).toHaveText('Recorded. Your fixture is ready to copy.')
  await expect(page.locator('#fixture-copy')).toBeEnabled()
  const script = await page.locator('#fixture-output').innerText()
  expect(script).toContain('mock.onMethod("GET"')
  expect(script).toContain('.replyOnce(200')
  expect(script).toContain('Npora')
  expect(requests).toHaveLength(1)
  await page.locator('#language').selectOption('zh-CN')
  await expect(page.locator('#fixture-run')).toHaveText('录制一次响应 ↗')
  await expect(page.locator('#fixture-status')).toHaveText('录制成功，脚本已可复制。')
  await expect(page.locator('#fixture-output')).toHaveText(script)
  await page.locator('#language').selectOption('en')
  await expect(page.locator('#fixture-output')).toHaveText(script)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})


test('the branded 404 defaults to English and retains language on return home', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist')
  expect(response?.status()).toBe(404)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle('Page not found · Npora Request')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This request took a wrong turn.')
  await page.locator('#language').selectOption('zh-CN')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('这次请求，走错了路。')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('#not-found-home').click()
  await expect(page.locator('#language')).toHaveValue('zh-CN')
  await expect(page.locator('#demo-title')).toHaveText('标准数据获取')
})
