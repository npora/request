import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createClient } from '../src'
import {
  parseBenchmarkOptions,
  printBenchmarkReport,
  runConcurrent,
  writeBenchmarkReport
} from './harness'

const options = parseBenchmarkOptions(process.argv.slice(2), {
  operations: 100_000,
  concurrency: 256,
  warmup: 500,
  samples: 4096
})
let received = 0
const server = createServer((_request, response) => {
  received += 1
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': '11'
  })
  response.end('{"ok":true}')
})

server.listen(0, '127.0.0.1')
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve)
  server.once('error', reject)
})

try {
  const { port } = server.address() as AddressInfo
  const client = createClient({
    baseURL: `http://127.0.0.1:${port}`
  })

  for (let index = 0; index < options.warmup; index += 1) {
    await client.get<{ ok: boolean }>('/health')
  }

  const result = await runConcurrent(
    options.operations,
    options.concurrency,
    () => client.get<{ ok: boolean }>('/load'),
    options.samples
  )

  assert.equal(received, options.warmup + options.operations)
  printBenchmarkReport({ localhostHttp: result })
  await writeBenchmarkReport(options.output, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    configuration: options,
    requestsReceived: received,
    scenarios: { localhostHttp: result }
  })
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}
