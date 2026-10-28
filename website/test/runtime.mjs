import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

export async function createRuntime(options = {}) {
  const state = await build({ entryPoints: [fileURLToPath(new URL('../state/worker.mjs', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false })
  return new Miniflare(convertV4MiniflareOptions({ ...options,
    workers: [
      { name: 'pages', modules: true, script: await readFile(new URL('../../.artifacts/website/functions/index.js', import.meta.url), 'utf8'),
        compatibilityDate: '2026-07-30',
        durableObjects: { DEMO_STATE: { className: 'DemoState', scriptName: 'state', useSQLite: true } },
        assets: { directory: fileURLToPath(new URL('../../.artifacts/website/public', import.meta.url)),
          binding: 'ASSETS', run_worker_first: true,
          routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
          assetConfig: { not_found_handling: '404-page' } } },
      { name: 'state', modules: true, script: state.outputFiles[0].text, compatibilityDate: '2026-07-30',
        durableObjects: { DEMO_STATE: { className: 'DemoState', useSQLite: true } } }
    ]
  }))
}
