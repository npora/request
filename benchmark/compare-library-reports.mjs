import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OWN_PACKAGE = '@npora/request'
const CONFIG_FIELDS = ['operations', 'concurrency', 'warmup', 'rounds']

export function compareReports(before, after) {
  for (const [label, report] of [['before', before], ['after', after]]) {
    assert.equal(report.schemaVersion, 2, `${label}: unsupported report schema`)
    assert.equal(report.balancedRoundOrder, true,
      `${label}: execution order is not balanced`)
    assert.ok(report.provenance?.gitCommit,
      `${label}: missing Git provenance`)
    assert.ok(report.provenance?.dependencyLockSha256,
      `${label}: missing dependency lock digest`)
    assert.ok(report.versions?.[OWN_PACKAGE],
      `${label}: missing package version`)
  }

  for (const field of [
    'node', 'platform', 'architecture', 'cpuModel', 'logicalCpus'
  ]) {
    assert.ok(before.runtime?.[field] && after.runtime?.[field],
      `Runtime ${field} is missing`)
    assert.equal(after.runtime?.[field], before.runtime?.[field],
      `Runtime ${field} differs`)
  }

  for (const field of CONFIG_FIELDS) {
    assert.equal(after.configuration?.[field], before.configuration?.[field],
      `Configuration ${field} differs`)
  }

  assert.deepEqual(after.configuration.scenarios, before.configuration.scenarios,
    'Scenario lists differ')
  assert.equal(after.provenance.dependencyLockSha256,
    before.provenance.dependencyLockSha256,
    'Dependency lock digests differ')

  const controls = Object.keys(before.versions)
    .filter(name => name !== OWN_PACKAGE)

  assert.ok(controls.length > 0, 'No unchanged controls in the reports')
  assert.deepEqual(Object.keys(after.versions).sort(),
    Object.keys(before.versions).sort(), 'Package lists differ')

  for (const name of controls) {
    assert.equal(after.versions[name], before.versions[name],
      `${name}: package version differs`)
  }

  const warnings = []

  if (before.provenance.gitDirty || after.provenance.gitDirty) {
    warnings.push('At least one report used an uncommitted worktree')
  }

  const scenarios = {}

  for (const scenario of before.configuration.scenarios) {
    const beforeResults = before.results?.[scenario]
    const afterResults = after.results?.[scenario]

    assert.ok(beforeResults && afterResults,
      `${scenario}: missing scenario results`)

    for (const name of [OWN_PACKAGE, ...controls]) {
      for (const [label, results] of [
        ['before', beforeResults], ['after', afterResults]
      ]) {
        const result = results[name]

        assert.ok(
          Number.isFinite(result?.medianRequestsPerSecond) &&
            result.medianRequestsPerSecond > 0 &&
            Number.isFinite(result.throughputRangePercent) &&
            typeof result.unstableThroughput === 'boolean',
          `${label} ${scenario} ${name}: invalid throughput summary`
        )

        if (result.unstableThroughput) {
          warnings.push(`${label} ${scenario} ${name}: unstable throughput`)
        }
      }
    }

    const controlRatios = controls.map(name =>
      afterResults[name].medianRequestsPerSecond /
      beforeResults[name].medianRequestsPerSecond
    ).sort((first, second) => first - second)
    const controlMedian = median(controlRatios)
    const controlRangePercent = 100 * (
      controlRatios.at(-1) - controlRatios[0]
    ) / controlMedian
    const ownRatio = afterResults[OWN_PACKAGE].medianRequestsPerSecond /
      beforeResults[OWN_PACKAGE].medianRequestsPerSecond

    if (controlRangePercent > 20) {
      warnings.push(`${scenario}: control changes vary by more than 20%`)
    }

    scenarios[scenario] = {
      beforeRequestsPerSecond: beforeResults[OWN_PACKAGE].medianRequestsPerSecond,
      afterRequestsPerSecond: afterResults[OWN_PACKAGE].medianRequestsPerSecond,
      changePercent: (ownRatio - 1) * 100,
      controlMedianChangePercent: (controlMedian - 1) * 100,
      adjustedChangePercent: (ownRatio / controlMedian - 1) * 100,
      controlRangePercent
    }
  }

  return {
    before: {
      version: before.versions[OWN_PACKAGE],
      commit: before.provenance.gitCommit
    },
    after: {
      version: after.versions[OWN_PACKAGE],
      commit: after.provenance.gitCommit
    },
    runtime: before.runtime,
    warnings,
    scenarios
  }
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforePath, afterPath] = process.argv.slice(2)

  assert.ok(beforePath && afterPath,
    'Usage: compare-library-reports.mjs <before.json> <after.json>')

  const [before, after] = await Promise.all(
    [beforePath, afterPath].map(async path =>
      JSON.parse(await readFile(path, 'utf8'))
    )
  )

  process.stdout.write(`${JSON.stringify(compareReports(before, after), null, 2)}\n`)
}
