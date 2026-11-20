import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { collectDependencies } from './dependency-closure.mjs'

function fixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'npora-closure-'))
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
    run(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const [declaration, runtime] of [['d.ts', 'js'], ['d.cts', 'cjs'], ['d.mts', 'mjs']]) {
  test(`${declaration} follows types when a same-named ${runtime} runtime exists`, () => {
    fixture({
      [`entry.${declaration}`]: `export { Value } from './shared.${runtime}'`,
      [`shared.${declaration}`]: 'export interface Value { ok: boolean }',
      [`shared.${runtime}`]: `require('./runtime-only.${runtime}')`,
      [`runtime-only.${runtime}`]: 'runtime implementation'
    }, root => {
      assert.deepEqual(collectDependencies(join(root, `entry.${declaration}`)), [
        join(root, `entry.${declaration}`), join(root, `shared.${declaration}`)
      ])
      assert.deepEqual(collectDependencies(join(root, `shared.${runtime}`)), [
        join(root, `shared.${runtime}`), join(root, `runtime-only.${runtime}`)
      ])
    })
  })
}

test('counts shared/cyclic declarations once, including type queries and side effects', () => {
  fixture({
    'entry.d.cts': 'import "./shared.cjs"; export type Value = import("./shared.cjs").Value',
    'shared.d.cts': 'import "./entry.cjs"; export interface Value { ok: boolean }',
    'shared.cjs': 'runtime implementation'
  }, root => {
    assert.deepEqual(collectDependencies(join(root, 'entry.d.cts')), [
      join(root, 'entry.d.cts'), join(root, 'shared.d.cts')
    ])
  })
})

test('runtime closure includes relative lazy imports and excludes external packages', () => {
  fixture({
    'entry.js': 'import "external"; export const load = () => import("./lazy.js")',
    'lazy.js': 'export const value = 1'
  }, root => {
    assert.deepEqual(collectDependencies(join(root, 'entry.js')), [join(root, 'entry.js'), join(root, 'lazy.js')])
  })
})

test('fails for missing internal declarations instead of silently excluding them', () => {
  fixture({
    'entry.d.cts': 'export { Value } from "./shared.cjs"',
    'shared.cjs': 'runtime implementation'
  }, root => {
    assert.throws(() => collectDependencies(join(root, 'entry.d.cts')), /Missing package dependency.*shared\.d\.cts/)
  })
})
