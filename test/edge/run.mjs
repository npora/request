import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./worker.mjs', import.meta.url))],
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false
})
const runtime = new Miniflare({
  workers: [
    { name: 'contract', modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-07-30', serviceBindings: { UPSTREAM: 'upstream' } },
    { name: 'upstream', modules: true,
      scriptPath: fileURLToPath(new URL('./upstream.mjs', import.meta.url)),
      compatibilityDate: '2026-07-30' }
  ]
})
try {
  const response = await runtime.dispatchFetch('https://contract.test/', { signal: AbortSignal.timeout(15000) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  for (const key of ['json', 'schema', 'formData', 'abort', 'timeout', 'sse', 'ndjson', 'tieredCache', 'formErrors']) {
    assert.equal(result[key], true, key)
  }
  console.log('workerd runtime contracts passed:', result)
} finally {
  await runtime.dispose()
}
