import assert from 'node:assert/strict'
import { createClient, isRequestError } from '../src/core-entry'

interface User {
  id: number
  name: string
}

const requests: Request[] = []
const fetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  requests.push(request)
  if (new URL(request.url).pathname.endsWith('/missing')) {
    return Response.json({ message: 'Missing user' }, { status: 404 })
  }
  if (request.method === 'POST') {
    const body = await request.json() as { name: string }
    return Response.json({ id: 2, name: body.name }, { status: 201 })
  }
  return Response.json({ id: 1, name: 'Ada' }, {
    headers: { 'x-request-id': 'migration-example' }
  })
}

const api = createClient({
  baseURL: 'https://example.test/api',
  timeout: 5000,
  fetch,
  fetchOptions: { credentials: 'include' }
})
const order: string[] = []
api.interceptors.request.use(config => {
  order.push('first')
  const headers = new Headers(config.headers)
  headers.set('x-app', 'dashboard')
  return { ...config, headers }
})
api.interceptors.request.use(config => {
  order.push('second')
  return config
})

const user = await api.get<User>('/users/1', {
  searchParams: new URLSearchParams([['tag', 'typescript'], ['tag', 'fetch']])
})
assert.deepEqual(user, { id: 1, name: 'Ada' })
assert.deepEqual(order, ['first', 'second'])
assert.equal(requests[0]!.url,
  'https://example.test/api/users/1?tag=typescript&tag=fetch')
assert.equal(requests[0]!.credentials, 'include')
assert.equal(requests[0]!.headers.get('x-app'), 'dashboard')

const created = await api.post<User>('/users', { json: { name: 'Grace' } })
assert.deepEqual(created, { id: 2, name: 'Grace' })
assert.match(requests[1]!.headers.get('content-type')!, /application\/json/)

const response = await api.getResponse<User>('/users/1')
assert.equal(response.status, 200)
assert.equal(response.headers.get('x-request-id'), 'migration-example')
assert.deepEqual(await response.raw.json(), response.data)

await assert.rejects(api.get('/missing'), (error: unknown) => {
  assert.ok(isRequestError(error))
  assert.equal(error.code, 'HTTP_ERROR')
  assert.equal(error.status, 404)
  assert.deepEqual(error.data, { message: 'Missing user' })
  return true
})

const controller = new AbortController()
controller.abort()
const beforeCancel = requests.length
await assert.rejects(api.get('/users/1', { signal: controller.signal }),
  (error: unknown) => isRequestError(error) && error.code === 'ABORT_ERROR')
assert.equal(requests.length, beforeCancel)

const beforeExtend = order.length
await api.extend({ headers: { 'x-role': 'admin' } }).get('/users/1')
assert.equal(order.length, beforeExtend)
const derivedRequest = requests[requests.length - 1]!
assert.equal(derivedRequest.headers.get('x-app'), null)
assert.equal(derivedRequest.headers.get('x-role'), 'admin')
assert.equal(derivedRequest.credentials, 'include')

console.log('Axios migration example passed.')
