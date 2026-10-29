import { mkdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('./', import.meta.url)
const output = new URL('./dist/', root)
const { version } = JSON.parse(await readFile(new URL('../package.json', root), 'utf8'))
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
// Explicit allowlist: never upload functions, tooling, credentials or source maps.
for (const name of ['index.html', 'style.css', 'favicon.svg', '_headers', '_routes.json', '404.html']) {
  await copyFile(new URL(name, root), new URL(name, output))
}
await build({ entryPoints: [fileURLToPath(new URL('app.js', root))],
  outfile: fileURLToPath(new URL('app.js', output)), bundle: true,
  platform: 'browser', format: 'esm', target: 'es2022', minify: true,
  define: { __VERSION__: JSON.stringify(version) } })
await writeFile(new URL('build.json', output), JSON.stringify({ version }))
console.log(`Website v${version} built in website/dist`)
