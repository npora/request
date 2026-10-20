import assert from 'node:assert/strict'
import { createClient, isRequestError, type StandardSchemaV1 } from '../src/core-entry'
import { rateLimitPlugin } from '../src/plugins/rateLimitPlugin'

// An application maps known failures to its own UI outcomes. Unknown application
// errors stay observable rather than being mislabeled as a network problem.
function outcome(error: unknown) {
  if (!isRequestError(error)) throw error
  switch (error.code) {
    case 'ABORT_ERROR': return 'cancelled'
    case 'HTTP_ERROR':
      if (error.status === 404) return 'missing'
      if (error.status === 401) return 'sign-in'
      if (error.status === 429) return 'server-throttled'
      return 'http-failure'
    case 'NETWORK_ERROR': return 'connection-failed'
    case 'TIMEOUT_ERROR': return 'deadline-expired'
    case 'PARSER_ERROR':
    case 'SCHEMA_ERROR': return 'invalid-data'
    case 'CONFIG_ERROR': return 'invalid-request'
    case 'REQUEST_TOO_LARGE':
    case 'RESPONSE_TOO_LARGE': return 'too-large'
    case 'CIRCUIT_OPEN':
    case 'CONCURRENCY_LIMIT':
    case 'RATE_LIMIT': return 'locally-busy'
    default: {
      const exhaustive: never = error.code
      return exhaustive
    }
  }
}

let calls = 0
const api = createClient({ fetch: async input => {
  calls++
  switch (new URL(String(input)).pathname) {
    case '/missing': return Response.json({ message: 'Missing' }, { status: 404 })
    case '/throttled': return Response.json({ message: 'Wait' }, { status: 429 })
    case '/invalid': return new Response('{', { headers: { 'content-type': 'application/json' } })
    case '/offline': throw new TypeError('Connection lost')
    default: return Response.json({ id: 'wrong type' })
  }
} })

async function expectOutcome(pending: Promise<unknown>, expected: string) {
  await assert.rejects(pending, (error: unknown) => {
    assert.equal(outcome(error), expected)
    assert.ok(isRequestError(error))
    assert.equal('config' in error.toJSON(), false)
    return true
  })
}

await expectOutcome(api.get('https://example.test/missing'), 'missing')
await expectOutcome(api.get('https://example.test/throttled'), 'server-throttled')
await expectOutcome(api.get('https://example.test/invalid'), 'invalid-data')
await expectOutcome(api.get('https://example.test/offline'), 'connection-failed')

const schema: StandardSchemaV1<unknown, { id: number }> = {
  '~standard': {
    version: 1, vendor: 'example',
    validate(value) {
      return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number'
        ? { value: { id: value.id } }
        : { issues: [{ message: 'Expected a numeric id' }] }
    }
  }
}
await assert.rejects(api.get('https://example.test/profile', { schema }), error => {
  assert.equal(outcome(error), 'invalid-data')
  assert.ok(isRequestError(error))
  assert.equal(error.code, 'SCHEMA_ERROR')
  assert.equal(error.status, 200)
  return true
})

const controller = new AbortController()
controller.abort()
const beforeAbort = calls
await expectOutcome(api.get('https://example.test/cancelled', { signal: controller.signal }), 'cancelled')
assert.equal(calls, beforeAbort)

api.use(rateLimitPlugin({ maxRequests: 1, interval: 60000, maxQueue: 0 }))
try {
  await api.get('https://example.test/first')
  const beforeLimit = calls
  await assert.rejects(api.get('https://example.test/second'), error => {
    assert.ok(isRequestError(error))
    assert.equal(error.code, 'RATE_LIMIT')
    assert.equal(error.status, undefined)
    assert.equal(outcome(error), 'locally-busy')
    return true
  })
  assert.equal(calls, beforeLimit)
} finally { api.unuse('rate-limit') }

const applicationError = new Error('Application invariant failed')
assert.throws(() => outcome(applicationError), error => error === applicationError)
console.log('Error handling passed: HTTP, parser, network, schema, abort, local admission, and unknown errors.')
