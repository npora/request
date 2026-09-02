import { strict as assert } from 'node:assert'
import { performance } from 'node:perf_hooks'
import {
  createClient,
  SchemaValidationError,
  type ServerSentEvent,
  type StandardSchemaV1
} from '../src'
import {
  parseBenchmarkOptions,
  writeBenchmarkReport
} from './harness'

const options = parseBenchmarkOptions(process.argv.slice(2), {
  operations: 1_000_000,
  concurrency: 1,
  warmup: 1000
})
const chunkSize = 65_521
const ndjsonSchema = createNdjsonSchema()
const sseSchema = createSseSchema()

await warmup(options.warmup)

const ndjson = await runSuccess('ndjson', options.operations, true)
const sse = await runSuccess('sse', options.operations, true)
const validationFailures = {
  ndjson: await verifyValidationFailure('ndjson'),
  sse: await verifyValidationFailure('sse')
}
const cancellation = {
  ndjson: await verifyConsumerCancellation('ndjson'),
  sse: await verifyConsumerCancellation('sse')
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch
  },
  configuration: {
    recordsPerFormat: options.operations,
    warmup: options.warmup,
    chunkSize
  },
  summary: {
    recordsValidated: ndjson.records + sse.records,
    validationFailuresVerified: 2,
    cancellationPropagationsVerified: 2
  },
  scenarios: { ndjson, sse },
  validationFailures,
  cancellation
}

console.table({
  ndjson: printable(ndjson),
  sse: printable(sse)
})
console.log(
  `Validated ${(ndjson.records + sse.records).toLocaleString('en-US')} ` +
  'stream items with cross-chunk parsing, slow-consumer backpressure, ' +
  'schema-failure cancellation, and consumer cancellation.'
)
await writeBenchmarkReport(options.output, report)

async function runSuccess(
  kind: 'ndjson' | 'sse',
  records: number,
  slowConsumer: boolean
) {
  globalThis.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const source = createRecordStream(kind, records, chunkSize)
  const client = createClient({
    baseURL: 'https://stream-benchmark.invalid',
    fetch: async () => new Response(source.stream, {
      headers: {
        'content-type': kind === 'ndjson'
          ? 'application/x-ndjson'
          : 'text/event-stream'
      }
    })
  })
  const startedAt = performance.now()
  const iterable = kind === 'ndjson'
    ? await client.ndjson('/records', { itemSchema: ndjsonSchema })
    : await client.sse('/events', { itemSchema: sseSchema })
  let consumed = 0
  let checksum = 0
  let slowConsumerYields = 0

  for await (const value of iterable as AsyncIterable<number>) {
    checksum += value
    consumed += 1

    if (slowConsumer && consumed % 10_000 === 0) {
      slowConsumerYields += 1
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }

  const durationMs = performance.now() - startedAt
  const heapBeforeCollection = process.memoryUsage().heapUsed

  globalThis.gc?.()
  const retainedHeap = process.memoryUsage().heapUsed
  const expectedChecksum = records * (records - 1) / 2

  assert.equal(consumed, records)
  assert.equal(checksum, expectedChecksum)
  assert.equal(source.cancelled, false)
  if (records >= 10_000) {
    assert.ok(source.chunks > 1)
  }

  return {
    records: consumed,
    durationMs,
    recordsPerSecond: consumed / (durationMs / 1000),
    retainedHeapDeltaBytes: retainedHeap - heapBefore,
    preCollectionHeapDeltaBytes: heapBeforeCollection - heapBefore,
    checksum,
    chunks: source.chunks,
    slowConsumerYields,
    sourceCancelled: source.cancelled
  }
}

async function verifyValidationFailure(kind: 'ndjson' | 'sse') {
  let cancelled = false
  const encoder = new TextEncoder()
  const valid = kind === 'ndjson'
    ? '{"value":0}\n'
    : 'id: 0\nevent: item\ndata: 0\n\n'
  const invalid = kind === 'ndjson'
    ? '{"value":"invalid"}\n'
    : 'id: 1\nevent: item\ndata: invalid\n\n'
  let sent = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(encoder.encode(valid + invalid))
      }
    },
    cancel() {
      cancelled = true
    }
  })
  const client = createStreamClient(kind, stream)
  const iterable = kind === 'ndjson'
    ? await client.ndjson('/failure', { itemSchema: ndjsonSchema })
    : await client.sse('/failure', { itemSchema: sseSchema })
  try {
    for await (const _ of iterable) {
      // The second item intentionally fails.
    }
  } catch (caught) {
    if (!(caught instanceof SchemaValidationError)) throw caught

    assert.equal(caught.itemIndex, 1)
    assert.equal(cancelled, true)

    return {
      code: caught.code,
      itemIndex: caught.itemIndex,
      lineNumber: caught.lineNumber,
      event: caught.event,
      eventId: caught.eventId,
      sourceCancelled: cancelled
    }
  }

  throw new Error('Expected streaming schema validation to fail')
}

async function verifyConsumerCancellation(kind: 'ndjson' | 'sse') {
  const source = createRecordStream(kind, 1000, 31)
  const client = createStreamClient(kind, source.stream)
  const iterable = kind === 'ndjson'
    ? await client.ndjson<number>('/cancel')
    : await client.sse('/cancel', {})
  let consumed = 0

  for await (const _ of iterable) {
    consumed += 1

    if (consumed === 10) {
      break
    }
  }

  assert.equal(consumed, 10)
  assert.equal(source.cancelled, true)

  return { consumed, sourceCancelled: source.cancelled }
}

function createStreamClient(
  kind: 'ndjson' | 'sse',
  stream: ReadableStream<Uint8Array>
) {
  return createClient({
    baseURL: 'https://stream-benchmark.invalid',
    fetch: async () => new Response(stream, {
      headers: {
        'content-type': kind === 'ndjson'
          ? 'application/x-ndjson'
          : 'text/event-stream'
      }
    })
  })
}

function createRecordStream(
  kind: 'ndjson' | 'sse',
  records: number,
  targetChunkSize: number
) {
  const encoder = new TextEncoder()
  let index = 0
  let pending = ''
  let cancelled = false
  let chunks = 0

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      while (pending.length < targetChunkSize && index < records) {
        pending += kind === 'ndjson'
          ? `{"value":${index}}\n`
          : `id: ${index}\nevent: item\ndata: ${index}\n\n`
        index += 1
      }

      if (pending.length > 0) {
        const value = pending.slice(0, targetChunkSize)

        pending = pending.slice(targetChunkSize)
        chunks += 1
        controller.enqueue(encoder.encode(value))
        return
      }

      controller.close()
    },
    cancel() {
      cancelled = true
    }
  })

  return {
    stream,
    get cancelled() { return cancelled },
    get chunks() { return chunks }
  }
}

function createNdjsonSchema(): StandardSchemaV1<unknown, number> {
  return {
    '~standard': {
      version: 1,
      vendor: 'stream-benchmark',
      validate(value) {
        const item = value as { value?: unknown }

        return typeof item?.value === 'number'
          ? { value: item.value }
          : { issues: [{ message: 'Expected numeric value' }] }
      }
    }
  }
}

function createSseSchema(): StandardSchemaV1<unknown, number> {
  return {
    '~standard': {
      version: 1,
      vendor: 'stream-benchmark',
      validate(value) {
        const data = (value as ServerSentEvent | undefined)?.data ?? ''
        const numeric = Number(data)

        return Number.isSafeInteger(numeric)
          ? { value: numeric }
          : { issues: [{ message: 'Expected numeric event data' }] }
      }
    }
  }
}

async function warmup(records: number): Promise<void> {
  await runSuccess('ndjson', records, false)
  await runSuccess('sse', records, false)
}

function printable(result: Awaited<ReturnType<typeof runSuccess>>) {
  return {
    records: result.records,
    durationMs: result.durationMs.toFixed(2),
    recordsPerSecond: result.recordsPerSecond.toFixed(0),
    retainedHeapDeltaMiB: (
      result.retainedHeapDeltaBytes / 1024 / 1024
    ).toFixed(2),
    preCollectionHeapDeltaMiB: (
      result.preCollectionHeapDeltaBytes / 1024 / 1024
    ).toFixed(2),
    chunks: result.chunks,
    slowConsumerYields: result.slowConsumerYields
  }
}
