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

const compact = report.results['core + memory cache'].gzipBytes
const full = report.results['core + cache'].gzipBytes
assert.ok(compact <= full * 0.85,
  `Memory cache bundle (${compact}) must stay at least 15% below full cache (${full})`)

console.log('Consumer bundle budgets passed.')
