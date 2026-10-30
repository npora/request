import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { createSessionServer } from '../fixtures/session-server.mjs'


interface SessionResult {
  ok: boolean
  data?: { account: string }
  code?: string
  status?: number
}
interface BrowserSession {
  start(key: string, options?: { cached?: boolean; path?: string }): void
  wait(key: string): Promise<SessionResult>
  cancel(key: string): void
  state(): { token: string; closed: boolean; candidates: number }
  expire(): void
  omitRefreshCookie(): Promise<SessionResult>
  logout(): Promise<void>
}
declare global {
  interface Window {
    createBrowserSession(origin: string, account: string): Promise<BrowserSession>
    sessionFixture: BrowserSession
  }
}

let script: string

test.beforeAll(async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/session-app.js', import.meta.url))],
    bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false
  })
  script = bundled.outputFiles[0].text
})

test('cross-origin cookie refresh is shared and cancelling one waiter preserves another', async ({ page, context }) => {
  const server = await createSessionServer()
  try {
    await page.goto('/')
    await page.addScriptTag({ content: script })
    await page.evaluate(async origin => {
      const app = window
      app.sessionFixture = await app.createBrowserSession(origin, 'alice')
    }, server.origin)
    const cookies = await context.cookies(server.origin)
    expect(cookies.find(cookie => cookie.name === 'npora-session')).toMatchObject({ value: 'alice', httpOnly: true })
    expect(await page.evaluate(() => window.sessionFixture.omitRefreshCookie())).toMatchObject({ ok: false, code: 'HTTP_ERROR', status: 401 })
    await page.evaluate(() => {
      const session = window.sessionFixture
      session.start('cancelled'); session.start('survivor')
    })
    await expect.poll(() => page.evaluate(() => window.sessionFixture.state().candidates)).toBe(2)
    await expect.poll(() => server.stats('alice').refreshes).toBe(1)
    await page.evaluate(() => window.sessionFixture.cancel('cancelled'))
    expect(await page.evaluate(() => window.sessionFixture.wait('cancelled'))).toMatchObject({ ok: false, code: 'ABORT_ERROR' })
    expect(server.stats('alice').refreshClosed).toBe(0)
    server.release('alice')
    expect(await page.evaluate(() => window.sessionFixture.wait('survivor'))).toMatchObject({ ok: true, data: { account: 'alice' } })
    expect(server.stats('alice').refreshes).toBe(1)
    expect(server.stats('alice').unauthorized).toBe(2)
    expect(server.preflights.some(value => value.headers.includes('authorization'))).toBe(true)
    expect(server.preflights.some(value => value.method === 'POST' && value.headers.includes('content-type'))).toBe(true)
    expect(server.preflights.every(value => value.cookie === undefined)).toBe(true)
    // A successful HTTP response with an invalid CORS origin must stay unreadable.
    await page.evaluate(() => window.sessionFixture.start('denied', { path: '/denied' }))
    expect(await page.evaluate(() => window.sessionFixture.wait('denied'))).toMatchObject({ ok: false, code: 'NETWORK_ERROR' })
    await page.evaluate(() => window.sessionFixture.logout())
    expect(server.failures).toEqual([])
  } finally { await server.close() }
})

test('logout cancels a pending refresh and isolates another browser account and cache', async ({ page, browser }) => {
  const server = await createSessionServer()
  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()
  try {
    for (const [target, account] of [[page, 'alice'], [other, 'bob']] as const) {
      await target.goto('/')
      await target.addScriptTag({ content: script })
      await target.evaluate(async ({ origin, account }) => {
        const app = window
        app.sessionFixture = await app.createBrowserSession(origin, account)
        app.sessionFixture.start('initial')
      }, { origin: server.origin, account })
      await expect.poll(() => server.stats(account).refreshes).toBe(1)
      server.release(account)
      expect(await target.evaluate(() => window.sessionFixture.wait('initial'))).toMatchObject({ ok: true, data: { account } })
      await target.evaluate(async () => {
        const session = window.sessionFixture
        session.start('warm', { cached: true }); await session.wait('warm')
      })
    }
    const bobReads = server.stats('bob').reads
    await page.evaluate(() => window.sessionFixture.start('in-flight', { path: '/pending' }))
    await expect.poll(() => server.stats('alice').pending).toBe(1)
    await page.evaluate(() => {
      const session = window.sessionFixture
      session.expire(); session.start('refresh-at-logout')
    })
    await expect.poll(() => server.stats('alice').refreshes).toBe(2)
    await page.evaluate(() => window.sessionFixture.logout())
    expect(await page.evaluate(() => window.sessionFixture.wait('refresh-at-logout'))).toMatchObject({ ok: false, code: 'ABORT_ERROR' })
    await expect.poll(() => server.stats('alice').refreshClosed).toBe(1)
    await expect.poll(() => server.stats('alice').pendingClosed).toBe(1)
    expect(await page.evaluate(() => window.sessionFixture.wait('in-flight'))).toMatchObject({ ok: false, code: 'ABORT_ERROR' })
    server.release('alice')
    expect(await page.evaluate(() => window.sessionFixture.state())).toMatchObject({ closed: true, token: '' })
    await expect(page.evaluate(() => window.sessionFixture.start('after-logout'))).rejects.toThrow('Session closed')
    expect(await other.evaluate(async () => {
      const session = window.sessionFixture
      session.start('still-active', { cached: true }); return session.wait('still-active')
    })).toMatchObject({ ok: true, data: { account: 'bob' } })
    expect(server.stats('bob').reads).toBe(bobReads)
    expect(server.stats('bob').refreshes).toBe(1)
    await other.evaluate(() => window.sessionFixture.logout())
    expect(server.failures).toEqual([])
  } finally { await otherContext.close(); await server.close() }
})
