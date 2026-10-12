import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { compareReports } from '../benchmark/compare-library-reports.mjs'

function report() {
  return {
    schemaVersion: 2,
    balancedRoundOrder: true,
    runtime: {
      node: 'v24.18.0',
      platform: 'darwin',
      architecture: 'arm64',
      cpuModel: 'Example CPU',
      logicalCpus: 8
    },
    configuration: {
      operations: 5000,
      concurrency: 128,
      warmup: 1000,
      rounds: 5,
      scenarios: ['get-json']
    },
    versions: { '@npora/request': '1.18.3', controlA: '1', controlB: '2' },
    provenance: {
      gitCommit: 'baseline',
      gitDirty: false,
      dependencyLockSha256: 'same-lock'
    },
    results: {
      'get-json': {
        '@npora/request': summary(100),
        controlA: summary(100),
        controlB: summary(100)
      }
    }
  }
}

function summary(medianRequestsPerSecond, unstableThroughput = false) {
  return {
    medianRequestsPerSecond,
    throughputRangePercent: 5,
    unstableThroughput
  }
}

test('separates package change from a shared machine shift', () => {
  const before = report()
  const after = structuredClone(before)

  after.versions['@npora/request'] = '1.19.0'
  after.provenance.gitCommit = 'candidate'
  after.results['get-json']['@npora/request'] = summary(121)
  after.results['get-json'].controlA = summary(110)
  after.results['get-json'].controlB = summary(110)

  const comparison = compareReports(before, after)

  assert.ok(Math.abs(
    comparison.scenarios['get-json'].changePercent - 21
  ) < 1e-10)
  assert.ok(Math.abs(
    comparison.scenarios['get-json'].adjustedChangePercent - 10
  ) < 1e-10)
  assert.deepEqual(comparison.warnings, [])
})

test('rejects reports from different runtimes or dependency locks', () => {
  const before = report()
  const after = report()

  after.runtime.node = 'v22.0.0'
  assert.throws(() => compareReports(before, after), /Runtime node differs/)

  after.runtime.node = before.runtime.node
  after.runtime.cpuModel = 'Another CPU'
  assert.throws(() => compareReports(before, after), /Runtime cpuModel differs/)

  after.runtime.cpuModel = before.runtime.cpuModel
  after.provenance.dependencyLockSha256 = 'different-lock'
  assert.throws(() => compareReports(before, after),
    /Dependency lock digests differ/)
})

test('flags unstable measurements and uncommitted source', () => {
  const before = report()
  const after = report()

  after.provenance.gitDirty = true
  after.results['get-json']['@npora/request'] = summary(100, true)

  const comparison = compareReports(before, after)

  assert.equal(comparison.warnings.length, 2)
  assert.match(comparison.warnings[0], /uncommitted worktree/)
  assert.match(comparison.warnings[1], /unstable throughput/)
})

test('flags divergent controls before interpreting the adjusted change', () => {
  const before = report()
  const after = report()

  after.results['get-json'].controlB = summary(130)

  const comparison = compareReports(before, after)

  assert.ok(comparison.scenarios['get-json'].controlRangePercent > 20)
  assert.match(comparison.warnings[0], /control changes vary/)
})
