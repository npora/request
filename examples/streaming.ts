import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createClient,
  isRequestError,
  isSchemaValidationError,
  type StandardSchemaV1
} from '../src'

interface AuditRecord {
  id: number
  action: string
}

// A small Standard Schema validator keeps this example dependency-free.
// Applications can pass their existing Zod, Valibot, or ArkType schema instead.
const recordSchema: StandardSchemaV1<unknown, AuditRecord> = {
  '~standard': {
    version: 1,
    vendor: 'streaming-example',
    validate(value) {
      if (
        typeof value !== 'object' || value === null ||
        !('id' in value) || typeof value.id !== 'number' ||
        !Number.isSafeInteger(value.id) ||
        !('action' in value) || typeof value.action !== 'string'
      ) {
        return { issues: [{ message: 'Expected an integer id and string action' }] }
      }

      return { value: { id: value.id, action: value.action } }
    }
  }
}

const server = createServer((incoming, response) => {
  switch (incoming.url) {
    case '/events':
      sendChunks(response, 'text/event-stream', [
        ': connected\n\n',
        'id: 1\nevent: update\ndata: Hello\n\n',
        'id: 2\nevent: update\ndata: 流式响应\n\n'
      ])
      break
    case '/records':
      sendChunks(response, 'application/x-ndjson', [
        '{"id":1,"action":"created"}\n',
        '{"id":2,"action":"updated"}\n',
        '{"id":3,"action":"archived"}\n'
      ])
      break
    case '/invalid':
      sendChunks(response, 'application/x-ndjson', [
        '{"id":1,"action":"created"}\n',
        '{"id":"invalid","action":"updated"}\n'
      ])
      break
    default:
      response.writeHead(404).end()
  }
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  const address = server.address() as AddressInfo
  const api = createClient({
    baseURL: `http://127.0.0.1:${address.port}`,
    totalTimeout: 5000,
    maxResponseSize: 64 * 1024
  })

  // SSE data stays a string; applications choose whether to decode JSON.
  console.log('\n1. Consume SSE events')
  let eventsSeen = 0
  for await (const event of await api.sse('/events')) {
    console.log(event.id, event.event, event.data)
    eventsSeen += 1
  }
  assert.equal(eventsSeen, 2)

  // Output types are inferred from itemSchema. Breaking cancels the reader.
  console.log('\n2. Validate NDJSON records and stop after two items')
  let recordsSeen = 0
  for await (const record of await api.ndjson('/records', {
    itemSchema: recordSchema
  })) {
    console.log(record.id, record.action)
    if (++recordsSeen === 2) break
  }
  assert.equal(recordsSeen, 2)

  // Catch around request creation and consumption: stream errors can happen
  // after the request promise has already resolved.
  console.log('\n3. Cancel an active stream')
  const controller = new AbortController()
  let cancelled = false
  try {
    const records = await api.ndjson('/records', {
      itemSchema: recordSchema,
      signal: controller.signal
    })
    for await (const record of records) {
      console.log(record.id, record.action)
      controller.abort()
    }
  } catch (error) {
    if (!isRequestError(error) || error.code !== 'ABORT_ERROR') throw error
    cancelled = true
    console.log(error.code)
  }
  assert.ok(cancelled, 'Cancellation should reject stream consumption')

  console.log('\n4. Report an invalid NDJSON item')
  let rejected = false
  try {
    for await (const record of await api.ndjson('/invalid', {
      itemSchema: recordSchema
    })) {
      console.log(record.id, record.action)
    }
  } catch (error) {
    if (!isSchemaValidationError(error)) throw error
    assert.equal(error.itemIndex, 1)
    assert.equal(error.lineNumber, 2)
    rejected = true
    console.log(error.code, {
      itemIndex: error.itemIndex,
      lineNumber: error.lineNumber,
      issues: error.issues
    })
  }
  assert.ok(rejected, 'The invalid record should fail validation')
  console.log('\nStreaming example completed.')
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

function sendChunks(
  response: ServerResponse,
  contentType: string,
  chunks: readonly string[]
): void {
  response.writeHead(200, { 'content-type': contentType })
  response.flushHeaders()
  let index = 0
  const timer = setInterval(() => {
    const chunk = chunks[index++]
    if (chunk === undefined) {
      clearInterval(timer)
      response.end()
    } else {
      response.write(chunk)
    }
  }, 20)
  response.once('close', () => clearInterval(timer))
}
