import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const publicImports = {
  '../src': '@npora/request',
  '../src/core-entry': '@npora/request/core',
  '../src/plugins/authPlugin': '@npora/request/plugins/auth',
  '../src/plugins/cachePlugin': '@npora/request/plugins/cache',
  '../src/plugins/retryPlugin': '@npora/request/plugins/retry',
  '../src/plugins/rateLimitPlugin': '@npora/request/plugins/rate-limit',
  '../src/plugins/concurrencyPlugin': '@npora/request/plugins/concurrency'
}

/** Transpile example fixtures without bundling the implementation under test. */
export async function buildInstalledWorkflows(directory) {
  const paths = []
  const workflows = ['axios-migration', 'session', 'session-isolation', 'errors', 'batch']
  for (const name of workflows) {
    const sourcefile = `${name}.ts`
    const outfile = join(directory, `${name}.mjs`)
    const result = await build({
      stdin: {
        contents: readFileSync(join(root, 'examples', sourcefile), 'utf8'),
        sourcefile, resolveDir: join(root, 'examples'), loader: 'ts'
      },
      outfile, bundle: true, packages: 'external',
      platform: 'node', format: 'esm', target: 'node22',
      metafile: true, logLevel: 'silent',
      plugins: [{
        name: 'public-package-imports',
        setup(builder) {
          builder.onResolve({ filter: /^\.\.\/src(?:\/|$)/ }, ({ path }) => {
            const entry = publicImports[path]
            assert.ok(entry, `Add a public import mapping for ${path}`)
            return { path: entry, external: true }
          })
        }
      }]
    })
    assert.equal(Object.keys(result.metafile.inputs).length, 1,
      `${name} bundled implementation code instead of importing the installed package`)
    const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports)
    assert.ok(imports.some(entry => entry.path.startsWith('@npora/request')), `${name} has no package imports`)
    for (const entry of imports) {
      assert.ok(entry.external && (entry.path.startsWith('node:') ||
        Object.values(publicImports).includes(entry.path)),
      `${name} has an unexpected runtime dependency: ${entry.path}`)
    }
    paths.push(outfile)
  }
  return paths
}
