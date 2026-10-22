import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { summarizeBrowserBundle } from '../../benchmark/browser-bundle.mjs'

function output(path, source) {
  return { path: resolve(path), contents: Buffer.from(source) }
}

test('counts shared static chunks once and keeps lazy chunks out of initial cost', () => {
  const files = [output('out/app.js', 'application'), output('out/shared.js', 'shared'),
    output('out/stream.js', 'streaming'), output('out/nested.js', 'nested')]
  const bundle = {
    outputFiles: files,
    metafile: { outputs: {
      'out/app.js': { entryPoint: 'app.ts', imports: [
        { kind: 'import-statement', path: 'out/shared.js' },
        { kind: 'dynamic-import', path: 'out/stream.js' }
      ] },
      'out/shared.js': { imports: [] },
      'out/stream.js': { entryPoint: 'stream.ts', imports: [
        { kind: 'import-statement', path: 'out/shared.js' },
        { kind: 'import-statement', path: 'out/nested.js' }
      ] },
      'out/nested.js': { imports: [] }
    } }
  }
  const result = summarizeBrowserBundle(bundle)
  assert.equal(result.initial.bytes, Buffer.byteLength('applicationshared'))
  assert.equal(result.initial.gzipBytes,
    gzipSync(files[0].contents, { level: 9 }).length + gzipSync(files[1].contents, { level: 9 }).length)
  assert.equal(result.initial.files, 2)
  assert.equal(result.lazy.bytes, Buffer.byteLength('streamingnested'))
  assert.equal(result.lazy.files, 2)
  assert.equal(result.total.bytes, result.initial.bytes + result.lazy.bytes)
  assert.equal(result.total.gzipBytes, result.initial.gzipBytes + result.lazy.gzipBytes)
  assert.equal(result.total.files, 4)
})

test('handles static import cycles and ignores external dependencies', () => {
  const result = summarizeBrowserBundle({
    outputFiles: [output('out/app.js', 'app'), output('out/shared.js', 'shared')],
    metafile: { outputs: {
      'out/app.js': { entryPoint: 'app.ts', imports: [
        { kind: 'import-statement', path: 'out/shared.js' },
        { kind: 'import-statement', path: 'external', external: true }
      ] },
      'out/shared.js': { imports: [{ kind: 'import-statement', path: 'out/app.js' }] }
    } }
  })
  assert.deepEqual(result.initial, result.total)
  assert.deepEqual(result.lazy, { bytes: 0, gzipBytes: 0, files: 0 })
})

test('rejects incomplete bundle metadata instead of undercounting it', () => {
  assert.throws(() => summarizeBrowserBundle({
    outputFiles: [output('out/app.js', 'app')],
    metafile: { outputs: {
      'out/app.js': { entryPoint: 'app.ts', imports: [
        { kind: 'import-statement', path: 'out/missing.js' }
      ] }
    } }
  }), /Missing output metadata/)
})

test('budget checker rejects growth hidden in lazy chunks with a passing initial bundle', async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const directory = await mkdtemp(resolve(tmpdir(), 'request-split-budget-'))
  try {
    const limits = JSON.parse(await readFile(
      new URL('../../benchmark/consumer-size-budget.json', import.meta.url), 'utf8'
    ))
    const report = { schemaVersion: 3, results: Object.fromEntries(
      Object.entries(limits).map(([name, limit]) => [name, {
        bytes: limit * 2, gzipBytes: Math.floor(limit / 2)
      }])
    ) }
    report.splitResults = Object.fromEntries(Object.entries(report.results).map(([name, result]) => {
      const initial = { bytes: result.bytes, gzipBytes: result.gzipBytes, files: 1 }
      return [name, { initial, lazy: { bytes: 0, gzipBytes: 0, files: 0 }, total: { ...initial } }]
    }))
    const path = resolve(directory, 'report.json')
    const checker = fileURLToPath(new URL('../../benchmark/check-consumer-size.mjs', import.meta.url))
    await writeFile(path, JSON.stringify(report))
    execFileSync(process.execPath, [checker, path], { stdio: 'pipe' })
    const split = report.splitResults['core: basic']
    split.lazy = { bytes: 200000, gzipBytes: 100000, files: 1 }
    split.total = {
      bytes: split.initial.bytes + split.lazy.bytes,
      gzipBytes: split.initial.gzipBytes + split.lazy.gzipBytes,
      files: 2
    }
    await writeFile(path, JSON.stringify(report))
    assert.throws(() => execFileSync(process.execPath, [checker, path], { stdio: 'pipe' }),
      /all split chunks total/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
