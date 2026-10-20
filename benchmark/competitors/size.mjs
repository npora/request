import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build, version as bundlerVersion } from 'esbuild'
import { hashFile, measurementMetadata } from '../provenance.mjs'

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'))
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  throw new Error('Usage: size.mjs [--output path]')
}
const resolveDir = fileURLToPath(new URL('.', import.meta.url))
const entries = {
  'native-fetch': `export const load = () => fetch('https://api.example.com/users/1').then(r => r.json())`,
  '@npora/request': `import {createClient} from '@npora/request/core';
    const api = createClient({baseURL:'https://api.example.com'});
    export const load = () => api.get('/users/1')`,
  'axios-default': `import axios from 'axios';
    const api = axios.create({baseURL:'https://api.example.com'});
    export const load = () => api.get('/users/1').then(r => r.data)`,
  'axios-fetch': `import axios from 'axios';
    const api = axios.create({baseURL:'https://api.example.com',adapter:'fetch'});
    export const load = () => api.get('/users/1').then(r => r.data)`,
  ky: `import ky from 'ky';
    export const load = () => ky('https://api.example.com/users/1',{retry:0,timeout:false}).json()`,
  ofetch: `import {ofetch} from 'ofetch';
    export const load = () => ofetch('https://api.example.com/users/1',{retry:0})`
}
const results = {}
for (const [name, contents] of Object.entries(entries)) {
  const bundle = await build({
    stdin: { contents, resolveDir, sourcefile: 'consumer-entry.js' },
    alias: { '@npora/request/core': fileURLToPath(new URL('../../dist/core.js', import.meta.url)) },
    bundle: true, minify: true, treeShaking: true,
    platform: 'browser', format: 'esm', target: 'es2020',
    write: false, metafile: true, logLevel: 'silent'
  })
  const output = bundle.outputFiles[0].contents
  results[name] = {
    bytes: output.byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    inputFiles: Object.keys(bundle.metafile.inputs).length
  }
}
const versions = Object.fromEntries(await Promise.all(['axios', 'ky', 'ofetch'].map(async name => [
  name, JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url))).version
])))
const manifest = JSON.parse(await readFile(new URL('package.json', import.meta.url)))
for (const [name, version] of Object.entries(versions)) {
  if (version !== manifest.dependencies[name]) throw new Error(`Run npm ci: unexpected ${name} version ${version}`)
}
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), ...measurementMetadata(),
  versions, comparisonLockSha256: hashFile(new URL('package-lock.json', import.meta.url)),
  bundler: 'esbuild', bundlerVersion, platform: 'browser', format: 'esm',
  target: 'es2020', gzipLevel: 9, entries, results
}
console.table(results)
if (args.length) {
  const output = resolve(args[1])
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Comparison size report: ${output}`)
}
