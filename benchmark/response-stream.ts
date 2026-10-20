import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createClient } from '@npora/request/core'
import { parseBenchmarkOptions, writeBenchmarkReport } from './harness'
import { measurementMetadata } from './provenance.mjs'

const options = parseBenchmarkOptions(process.argv.slice(2), {
  operations: 200000, concurrency: 1, warmup: 10000
})
assert.equal(options.concurrency, 1, 'Response stream benchmark uses one reader')
assert.equal(options.samples, undefined, 'Response stream benchmark uses five fixed rounds')
const chunkBytes = 256
const rounds = 5
const results: Record<string, unknown> = {}

async function run(chunks: number, preserveRaw: boolean) {
  let produced = 0
  let cancelled = 0
  const chunk = new Uint8Array(chunkBytes)
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced === chunks) controller.close()
      else {
        produced++
        controller.enqueue(chunk)
      }
    },
    cancel() { cancelled++ }
  }, { highWaterMark: 0 })
  const api = createClient({
    fetch: async () => new Response(source),
    timeout: 30000,
    maxResponseSize: chunks * chunkBytes,
    responseType: 'stream'
  })
  const started = performance.now()
  const stream = preserveRaw
    ? (await api.getResponse<ReadableStream<Uint8Array>>('https://example.test/stream')).data
    : await api.get<ReadableStream<Uint8Array>>('https://example.test/stream')
  const reader = stream.getReader()
  let received = 0
  let bytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      received++
      bytes += result.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const durationMs = performance.now() - started
  assert.equal(received, chunks)
  assert.equal(produced, chunks)
  assert.equal(bytes, chunks * chunkBytes)
  assert.equal(cancelled, 0)
  assert.equal(source.locked, false)
  return { durationMs, chunksPerSecond: chunks / (durationMs / 1000), bytes, chunks }
}

for (const [name, preserveRaw] of [['data', false], ['response', true]] as const) {
  await run(options.warmup, preserveRaw)
  const samples = []
  for (let round = 0; round < rounds; round++) samples.push(await run(options.operations, preserveRaw))
  const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b)
  results[name] = { medianDurationMs: durations[2], samples }
}
console.log(JSON.stringify(results, null, 2))
await writeBenchmarkReport(options.output, {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  ...measurementMetadata(),
  configuration: { ...options, chunkBytes, rounds }, results
})
