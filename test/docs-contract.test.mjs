import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
