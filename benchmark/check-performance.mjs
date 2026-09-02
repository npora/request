import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'

const options = parseOptions(process.argv.slice(2))
const [budget, request, streaming] = await Promise.all([
  readJson(options.budget),
  readJson(options.request),
  readJson(options.streaming)
])
const checks = []

assert.equal(budget.schemaVersion, 1, 'Unsupported performance budget schema')
assert.ok(request.scenarios, 'Request benchmark scenarios are missing')
assert.ok(streaming.scenarios, 'Streaming benchmark scenarios are missing')

for (const [expression, minimum] of Object.entries(budget.requestRatios)) {
  const [scenarioName, baselineName] = expression.split('/')
  const scenario = request.scenarios[scenarioName]
  const baseline = request.scenarios[baselineName]

  assert.ok(scenario, `Missing request scenario ${scenarioName}`)
  assert.ok(baseline, `Missing request baseline ${baselineName}`)

  const ratio = scenario.operationsPerSecond / baseline.operationsPerSecond

  checks.push({
    check: expression,
    measured: ratio,
    minimum
  })
  assert.ok(
    Number.isFinite(ratio) && ratio >= minimum,
    `${expression} throughput ratio ${ratio.toFixed(3)} is below ${minimum}`
  )
}

const streamBudget = budget.streaming

for (const name of ['ndjson', 'sse']) {
  const scenario = streaming.scenarios[name]
  const minimumThroughput = streamBudget.minimumRecordsPerSecond[name]

  assert.ok(scenario, `Missing streaming scenario ${name}`)
  assert.ok(
    scenario.records >= streamBudget.minimumRecordsPerFormat,
    `${name} validated only ${scenario.records} records`
  )
  assert.ok(
    scenario.recordsPerSecond >= minimumThroughput,
    `${name} throughput ${scenario.recordsPerSecond.toFixed(0)} is below ` +
      minimumThroughput
  )
  assert.ok(scenario.chunks > 1, `${name} did not exercise chunk boundaries`)
  assert.ok(
    scenario.slowConsumerYields >= streamBudget.minimumSlowConsumerYields,
    `${name} exercised only ${scenario.slowConsumerYields} slow-consumer yields`
  )
  assert.equal(
    scenario.checksum,
    scenario.records * (scenario.records - 1) / 2,
    `${name} checksum does not cover every ordered record`
  )
  assert.ok(
    scenario.retainedHeapDeltaBytes <=
      streamBudget.maximumRetainedHeapDeltaBytes,
    `${name} retained heap growth ${scenario.retainedHeapDeltaBytes} exceeds ` +
      streamBudget.maximumRetainedHeapDeltaBytes
  )
  assert.ok(
    scenario.preCollectionHeapDeltaBytes <=
      streamBudget.maximumPreCollectionHeapDeltaBytes,
    `${name} pre-collection heap growth ` +
      `${scenario.preCollectionHeapDeltaBytes} exceeds ` +
      streamBudget.maximumPreCollectionHeapDeltaBytes
  )

  checks.push({
    check: `${name}.recordsPerSecond`,
    measured: scenario.recordsPerSecond,
    minimum: minimumThroughput
  })
}

assert.ok(
  streaming.summary.validationFailuresVerified >=
    streamBudget.requiredValidationFailures,
  'Streaming schema failure coverage is incomplete'
)
assert.ok(
  streaming.summary.cancellationPropagationsVerified >=
    streamBudget.requiredCancellationPropagations,
  'Streaming cancellation coverage is incomplete'
)
assert.ok(
  Object.values(streaming.validationFailures).every(
    result => result.sourceCancelled === true
  ),
  'A schema failure did not cancel its source stream'
)
assert.ok(
  Object.values(streaming.cancellation).every(
    result => result.sourceCancelled === true
  ),
  'A consumer cancellation did not reach its source stream'
)

console.table(checks.map(check => ({
  check: check.check,
  measured: check.measured.toFixed(3),
  minimum: check.minimum.toFixed(3),
  passed: true
})))
console.log('Stable relative performance budgets passed.')

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function parseOptions(args) {
  const values = new Map()

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]

    if (name === '--') {
      continue
    }

    if (!name?.startsWith('--')) {
      throw new Error(`Unexpected performance option ${name}`)
    }

    const value = args[index + 1]

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}`)
    }

    values.set(name, value)
    index += 1
  }

  const result = {
    budget: values.get('--budget'),
    request: values.get('--request'),
    streaming: values.get('--streaming')
  }

  for (const [name, value] of Object.entries(result)) {
    if (!value) {
      throw new Error(`Missing --${name}`)
    }
  }

  return result
}
