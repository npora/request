import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cpSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkApiDocs } from './api-docs.mjs'
import { tmpdir } from 'node:os'
import { checkErrorCodeDocs } from './error-code-docs.mjs'

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'request-error-docs-'))
  const codes = ['CONFIG_ERROR', 'RATE_LIMIT']
  const write = (path, content) => writeFileSync(join(root, path), content)
  mkdirSync(join(root, 'src/errors'), { recursive: true })
  mkdirSync(join(root, 'docs'))
  write('src/errors/RequestError.ts', "export type RequestErrorCode = 'CONFIG_ERROR' | 'RATE_LIMIT'")
  write('README.md', `Stable request error codes:\n\n${codes.map(code => `- \`${code}\``).join('\n')}\n`)
  write('docs/api.md', `Error codes:\n\n\`\`\`ts\n${codes.join('\n')}\n\`\`\`\n`)
  try { run({ root, write }) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('accepts matching README and API code inventories', () => fixture(({ root }) => {
  assert.equal(checkErrorCodeDocs(root), 2)
}))

test('rejects a missing code even when it is mentioned elsewhere in README', () => fixture(({ root, write }) => {
  write('README.md', 'The rate limiter can produce RATE_LIMIT.\n\nStable request error codes:\n\n- `CONFIG_ERROR`\n')
  assert.throws(() => checkErrorCodeDocs(root), /README error codes differ/)
}))

test('checks the API reference independently', () => fixture(({ root, write }) => {
  write('docs/api.md', 'Error codes:\n\n```ts\nCONFIG_ERROR\n```\n')
  assert.throws(() => checkErrorCodeDocs(root), /API reference error codes differ/)
}))

test('rejects duplicate and obsolete entries', () => fixture(({ root, write }) => {
  for (const extra of ['RATE_LIMIT', 'OBSOLETE_ERROR']) {
    write('README.md', `Stable request error codes:\n\n- \`CONFIG_ERROR\`\n- \`RATE_LIMIT\`\n- \`${extra}\`\n`)
    assert.throws(() => checkErrorCodeDocs(root), /README error codes differ/)
  }
}))

test('requires documentation for newly added source codes', () => fixture(({ root, write }) => {
  write('src/errors/RequestError.ts', "export type RequestErrorCode = 'CONFIG_ERROR' | 'RATE_LIMIT' | 'HTTP_ERROR'")
  assert.throws(() => checkErrorCodeDocs(root), /README error codes differ/)
}))

function apiFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'request-api-docs-'))
  const repository = fileURLToPath(new URL('../', import.meta.url))
  for (const path of ['src', 'docs/api.md', 'docs/configuration.md', 'README.md', 'package.json', 'tsdown.config.ts']) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(repository, path), target, { recursive: true })
  }
  const edit = (path, update) => {
    const target = join(root, path)
    writeFileSync(target, update(readFileSync(target, 'utf8')))
  }
  try { run({ root, edit }) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('accepts current config, public entrypoint, and plugin inventories', () => apiFixture(({ root }) => {
  const result = checkApiDocs(root)
  assert.ok(result.fields > 0 && result.entrypoints > 0 && result.plugins > 0)
}))

test('rejects a missing API config field despite prose mentions', () => apiFixture(({ root, edit }) => {
  edit('docs/api.md', source => source.replace('  streamIdleTimeout?: number\n', ''))
  assert.throws(() => checkApiDocs(root), /API config fields differ/)
}))

test('requires new source config fields in the API reference', () => apiFixture(({ root, edit }) => {
  edit('src/types/config.ts', source => source.replace('export interface RequestConfig {',
    'export interface RequestConfig {\n  futureOption?: boolean'))
  assert.throws(() => checkApiDocs(root), /API config fields differ/)
}))

test('requires an option table row independently from API field coverage', () => apiFixture(({ root, edit }) => {
  edit('docs/configuration.md', source => source.replace(/^\| `maxStreamLineSize`.*\n/m, ''))
  assert.throws(() => checkApiDocs(root), /Configuration option table is missing maxStreamLineSize/)
}))

test('requires newly exported entrypoints in the public table', () => apiFixture(({ root, edit }) => {
  edit('package.json', source => {
    const manifest = JSON.parse(source)
    manifest.exports['./future'] = manifest.exports['./core']
    return JSON.stringify(manifest)
  })
  assert.throws(() => checkApiDocs(root), /API entrypoints differ/)
}))

test('rejects obsolete and duplicate public entrypoints', () => apiFixture(({ root, edit }) => {
  edit('docs/api.md', source => source.replace('<!-- /public-entrypoints -->',
    '| `./core` | duplicate |\n| `./obsolete` | removed |\n<!-- /public-entrypoints -->'))
  assert.throws(() => checkApiDocs(root), /API entrypoints differ/)
}))

test('requires the memory cache factory in the plugin inventory', () => apiFixture(({ root, edit }) => {
  edit('README.md', source => source.replace('- `memoryCachePlugin()`\n', ''))
  assert.throws(() => checkApiDocs(root), /README plugin list differs/)
}))

test('rejects duplicate plugin factories', () => apiFixture(({ root, edit }) => {
  edit('README.md', source => source.replace('- `cachePlugin()`\n',
    '- `cachePlugin()`\n- `cachePlugin()`\n'))
  assert.throws(() => checkApiDocs(root), /README plugin list differs/)
}))
