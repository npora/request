import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const reportPath = process.argv[2]
assert.ok(reportPath, 'Usage: check-consumer-size.mjs <report.json>')

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const limits = JSON.parse(readFileSync(
  new URL('./consumer-size-budget.json', import.meta.url), 'utf8'
))

for (const [name, maximum] of Object.entries(limits)) {
  const actual = report.results?.[name]?.gzipBytes
  assert.ok(Number.isSafeInteger(actual), `${name}: missing gzip measurement`)
  assert.ok(actual <= maximum,
    `${name}: ${actual} gzip bytes exceeds ${maximum}`)
}

if (report.schemaVersion >= 3) {
  for (const [name, maximum] of Object.entries(limits)) {
    const split = report.splitResults?.[name]
    assert.ok(split, `${name}: missing split bundle measurement`)
    for (const group of ['initial', 'lazy', 'total']) {
      for (const field of ['bytes', 'gzipBytes', 'files']) {
        assert.ok(Number.isSafeInteger(split[group]?.[field]) && split[group][field] >= 0,
          `${name}: invalid split ${group}.${field}`)
      }
    }
    assert.ok(split.initial.files >= 1, `${name}: initial entry is missing`)
    for (const field of ['bytes', 'gzipBytes', 'files']) {
      assert.equal(split.total[field], split.initial[field] + split.lazy[field],
        `${name}: split ${field} does not account for every output`)
    }
    assert.ok(split.total.gzipBytes <= maximum,
      `${name}: all split chunks total ${split.total.gzipBytes} gzip bytes exceeds ${maximum}`)
  }
}

const compact = report.results['core + memory cache'].gzipBytes
const full = report.results['core + cache'].gzipBytes
assert.ok(compact <= full * 0.85,
  `Memory cache bundle (${compact}) must stay at least 15% below full cache (${full})`)

console.log('Consumer bundle budgets passed.')
