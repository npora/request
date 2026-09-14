import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'

test('paired budget ignores one outlier but rejects a sustained regression', () => {
  const directory = mkdtempSync(join(tmpdir(), 'npora-budget-'))
  const budget = JSON.parse(readFileSync(
    resolve('benchmark/performance-budget.json'),
    'utf8'
  )) as { requestRatios: Record<string, number> }
  const expression = 'bareSequentialClient/directAdapter'
  const pairedRatios = Object.fromEntries(
    Object.keys(budget.requestRatios).map(name => [
      name,
      [1, 1, 1, 1, 1]
    ])
  )
  const request = {
    schemaVersion: 2,
    scenarios: {},
    pairedRatios
  }
  const streamScenario = {
    records: 1_000_000,
    recordsPerSecond: 200_000,
    chunks: 2,
    slowConsumerYields: 100,
    checksum: 499_999_500_000,
    retainedHeapDeltaBytes: 0,
    preCollectionHeapDeltaBytes: 0
  }
  const streaming = {
    scenarios: { ndjson: streamScenario, sse: streamScenario },
    summary: {
      validationFailuresVerified: 2,
      cancellationPropagationsVerified: 2
    },
    validationFailures: { sample: { sourceCancelled: true } },
    cancellation: { sample: { sourceCancelled: true } }
  }
  const requestPath = join(directory, 'request.json')
  const streamingPath = join(directory, 'streaming.json')

  try {
    writeFileSync(streamingPath, JSON.stringify(streaming))
    pairedRatios[expression] = [0.1, 0.8, 0.8, 0.8, 0.8]
    writeFileSync(requestPath, JSON.stringify(request))
    expect(checkBudget(requestPath, streamingPath).status).toBe(0)

    pairedRatios[expression] = [0.1, 0.2, 0.3, 0.8, 0.8]
    writeFileSync(requestPath, JSON.stringify(request))
    const failed = checkBudget(requestPath, streamingPath)

    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain(
      `${expression} throughput ratio 0.300 is below 0.4`
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function checkBudget(requestPath: string, streamingPath: string) {
  return spawnSync(process.execPath, [
    resolve('benchmark/check-performance.mjs'),
    '--',
    '--budget',
    resolve('benchmark/performance-budget.json'),
    '--request',
    requestPath,
    '--streaming',
    streamingPath
  ], { encoding: 'utf8' })
}
