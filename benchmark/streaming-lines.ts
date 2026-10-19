import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createClient } from '../src/core-entry'
import { parseBenchmarkOptions, writeBenchmarkReport } from './harness'

// operations is the largest payload length; samples is the number of rounds.
const options = parseBenchmarkOptions(process.argv.slice(2), {
  operations: 262_144, concurrency: 1, warmup: 1, samples: 3
})
assert.ok(options.operations >= 4, 'operations must be at least 4')
const chunkBytes = 64
const sizes = [...new Set([
  Math.floor(options.operations / 4), Math.floor(options.operations / 2), options.operations
])]
const scenarios = []
for (const format of ['ndjson', 'sse'] as const) {
  for (let round = 0; round < options.warmup; round += 1) await measure(format, 4096)
  for (const payloadCharacters of sizes) {
    const samples = []
    for (let round = 0; round < options.samples!; round += 1) {
      samples.push(await measure(format, payloadCharacters))
    }
    const durations = samples.map(sample => sample.milliseconds).sort((a, b) => a - b)
    scenarios.push({
      format, payloadCharacters, chunkBytes, chunks: samples[0]!.chunks,
      medianMilliseconds: durations[Math.floor(durations.length / 2)]!,
      samples
    })
  }
}
console.table(scenarios.map(({ samples: _samples, ...summary }) => summary))
await writeBenchmarkReport(options.output, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  configuration: { maximumPayloadCharacters: options.operations, rounds: options.samples, chunkBytes },
  scenarios
})

async function measure(format: 'ndjson' | 'sse', size: number) {
  const expected = 'x'.repeat(size)
  const bytes = new TextEncoder().encode(format === 'ndjson'
    ? JSON.stringify({ value: expected }) + '\r\n'
    : `data: ${expected}\r\n\r\n`)
  let offset = 0
  let chunks = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return }
      const end = Math.min(offset + chunkBytes, bytes.length)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
      chunks += 1
    }
  }, { highWaterMark: 0 })
  const client = createClient({ fetch: async () => new Response(body) })
  const started = performance.now()
  let records = 0
  if (format === 'ndjson') {
    for await (const item of await client.ndjson<{ value: string }>('https://example.test')) {
      assert.equal(item.value, expected)
      records += 1
    }
  } else {
    for await (const item of await client.sse('https://example.test')) {
      assert.equal(item.data, expected)
      records += 1
    }
  }
  const milliseconds = performance.now() - started
  assert.equal(records, 1)
  assert.equal(chunks, Math.ceil(bytes.length / chunkBytes))
  return { milliseconds, chunks }
}
