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
    const report = JSON.parse(await readFile(
      new URL('../../docs/measurements/1.19.3/consumer.json', import.meta.url), 'utf8'
    ))
    report.schemaVersion = 3
    report.splitResults = Object.fromEntries(Object.entries(report.results).map(([name, result]) => {
      const initial = { bytes: result.bytes, gzipBytes: result.gzipBytes, files: 1 }
      return [name, { initial, lazy: { bytes: 0, gzipBytes: 0, files: 0 }, total: { ...initial } }]
    }))
    const path = resolve(directory, 'report.json')
    const checker = fileURLToPath(new URL('../../benchmark/check-consumer-size.mjs', import.meta.url))
    await writeFile(path, JSON.stringify(report))
    execFileSync(process.execPath, [checker, path], { stdio: 'pipe' })
    const split = report.splitResults['core: basic']
    split.lazy = { bytes: 2000, gzipBytes: 1000, files: 1 }
    split.total = {
      bytes: split.initial.bytes + 2000,
      gzipBytes: split.initial.gzipBytes + 1000,
      files: 2
    }
    await writeFile(path, JSON.stringify(report))
    assert.throws(() => execFileSync(process.execPath, [checker, path], { stdio: 'pipe' }),
      /all split chunks total/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
