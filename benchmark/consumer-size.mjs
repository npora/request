import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const scenarios = {
  'root: basic': `
    import { createClient } from '@npora/request'
    export const api = createClient({ baseURL: 'https://api.example.com' })
    export const load = () => api.get('/users/1')
  `,
  'core: basic': `
    import { createClient } from '@npora/request/core'
    export const api = createClient({ baseURL: 'https://api.example.com' })
    export const load = () => api.get('/users/1')
  `,
  'core + retry': `
    import { createClient } from '@npora/request/core'
    import { retryPlugin } from '@npora/request/plugins/retry'
    export const api = createClient({ baseURL: 'https://api.example.com' })
      .use(retryPlugin({ retries: 2 }))
    export const load = () => api.get('/users/1')
  `,
  'core + cache': `
    import { createClient } from '@npora/request/core'
    import { cachePlugin } from '@npora/request/plugins/cache'
    export const api = createClient({
      baseURL: 'https://api.example.com',
      extensions: { cache: { enabled: true } }
    }).use(cachePlugin())
    export const load = () => api.get('/users/1')
  `,
  'root: retry + cache': `
    import { createClient, retryPlugin, cachePlugin } from '@npora/request'
    export const api = createClient({
      baseURL: 'https://api.example.com',
      extensions: { cache: { enabled: true } }
    }).use(retryPlugin({ retries: 2 })).use(cachePlugin())
    export const load = () => api.get('/users/1')
  `,
  'core + retry + cache': `
    import { createClient } from '@npora/request/core'
    import { retryPlugin } from '@npora/request/plugins/retry'
    import { cachePlugin } from '@npora/request/plugins/cache'
    export const api = createClient({
      baseURL: 'https://api.example.com',
      extensions: { cache: { enabled: true } }
    }).use(retryPlugin({ retries: 2 })).use(cachePlugin())
    export const load = () => api.get('/users/1')
  `
}

const results = {}

for (const [name, source] of Object.entries(scenarios)) {
  const bundle = await build({
    stdin: {
      contents: source,
      resolveDir: root,
      sourcefile: 'consumer-entry.js',
      loader: 'js'
    },
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    outfile: 'consumer-bundle.js',
    metafile: true,
    write: false,
    logLevel: 'silent'
  })
  const output = bundle.outputFiles?.[0]?.contents

  assert.ok(output, `No bundle produced for ${name}`)
  assert.ok(
    bundle.metafile?.outputs['consumer-bundle.js'],
    `No bundle metadata produced for ${name}`
  )

  results[name] = {
    bytes: output.byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    inputFiles: Object.keys(bundle.metafile.inputs).length
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  bundler: 'esbuild',
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  results
}

console.table(results)

const args = process.argv.slice(2)

if (args[0] === '--') {
  args.shift()
}

const outputIndex = args.indexOf('--output')

if (outputIndex !== -1) {
  assert.equal(outputIndex, 0, 'Usage: consumer-size.mjs [--output path]')
  assert.equal(args.length, 2, 'Usage: consumer-size.mjs [--output path]')
  const outputPath = resolve(args[1])

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Consumer size report: ${outputPath}`)
} else {
  assert.equal(args.length, 0, 'Usage: consumer-size.mjs [--output path]')
}
