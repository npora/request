import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, test } from '@playwright/test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = readFileSync(
  new URL('../../test/consumer/browser-app.js', import.meta.url),
  'utf8'
)

test('a bundled browser application handles cache, errors, and cancellation', async ({ page }) => {
  const bundled = await build({
    stdin: {
      contents: source,
      resolveDir: root,
      sourcefile: 'browser-app.js'
    },
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    outfile: 'browser-app.js',
    write: false
  })
  const script = bundled.outputFiles?.[0]?.text

  expect(script).toBeTruthy()
  await page.goto('/')
  await page.addScriptTag({ content: script })

  const result = await page.evaluate(async () => {
    const app = (window as unknown as {
      consumerApp: {
        load(key: string): Promise<{ count: number }>
        clear(): Promise<void> | void
        fail(): Promise<unknown>
        abort(): Promise<unknown>
      }
    }).consumerApp
    const key = crypto.randomUUID()
    const first = await app.load(key)
    const cached = await app.load(key)

    await app.clear()

    const fresh = await app.load(key)
    let errorCode: string | undefined
    let abortCode: string | undefined

    try {
      await app.fail()
    } catch (error) {
      errorCode = (error as { code?: string }).code
    }

    try {
      await app.abort()
    } catch (error) {
      abortCode = (error as { code?: string }).code
    }

    return { first, cached, fresh, errorCode, abortCode }
  })

  expect(result).toEqual({
    first: { count: 1 },
    cached: { count: 1 },
    fresh: { count: 2 },
    errorCode: 'HTTP_ERROR',
    abortCode: 'ABORT_ERROR'
  })
})
