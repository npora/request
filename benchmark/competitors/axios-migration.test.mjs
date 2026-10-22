import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import axios from 'axios'
import { createClient, isRequestError } from '../../dist/core.js'

const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url)))
assert.equal(axios.VERSION, manifest.dependencies.axios, 'Run npm ci in benchmark/competitors')
const pending = new Map()
let baseURL
let npora
const server = createServer((request, response) => {
  void handle(request, response).catch(error => response.destroy(error))
})

async function handle(request, response) {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/api/pending') {
    pending.get(url.searchParams.get('id'))?.()
    return // The client must abort this response; no timing-based server delay.
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks)
  response.setHeader('content-type', 'application/json')
  response.setHeader('x-migration', 'verified')
  if (url.pathname === '/api/missing') {
    response.statusCode = 404
    response.end(JSON.stringify({ message: 'Missing user' }))
    return
  }
  let fields
  if (request.headers['content-type']?.startsWith('multipart/form-data')) {
    const form = await new Request('http://localhost', {
      method: 'POST', headers: { 'content-type': request.headers['content-type'] }, body
    }).formData()
    fields = []
    for (const [name, value] of form) {
      fields.push([name, typeof value === 'string' ? value : {
        name: value.name, type: value.type, text: await value.text()
      }])
    }
  }
  response.end(JSON.stringify({
    method: request.method, url: request.url,
    contentType: request.headers['content-type'],
    marker: request.headers['x-migration'],
    body: fields ? undefined : body.toString('utf8'), fields
  }))
}

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseURL = `http://127.0.0.1:${server.address().port}/api`
  npora = createClient({ baseURL, totalTimeout: 3000 })
})
after(async () => {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

for (const adapter of ['http', 'fetch']) {
  const oldClient = () => axios.create({ baseURL, adapter, proxy: false, timeout: 3000 })
  const options = { timeout: 5000 }

  test(`${adapter}: base path, scalar query, headers and data-first return`, options, async () => {
    const headers = { 'x-migration': 'dashboard' }
    const params = { page: 2, search: 'hello world', active: false }
    const old = await oldClient().get('/users', { params, headers })
    const next = await npora.get('/users', { query: params, headers })
    assert.deepEqual(next, old.data)
    assert.equal(next.url, '/api/users?page=2&search=hello+world&active=false')
    assert.equal(next.marker, 'dashboard')
  })

  test(`${adapter}: repeated keys preserve order with URLSearchParams`, options, async () => {
    const params = new URLSearchParams([['tag', 'a b'], ['tag', '中文'], ['empty', '']])
    const old = await oldClient().get('/users', { params })
    const next = await npora.get('/users', { searchParams: params })
    assert.deepEqual(next, old.data)
    assert.equal(next.url, `/api/users?${params}`)
  })

  test(`${adapter}: Axios bracket arrays need an explicit migration serializer`, options, async () => {
    const old = await oldClient().get('/users', { params: { tag: ['a', 'b'] } })
    const next = await npora.get('/users', {
      query: { tag: ['a', 'b'] },
      querySerializer(query) {
        const params = new URLSearchParams()
        for (const tag of query.tag) params.append('tag[]', String(tag))
        return params.toString()
      }
    })
    const oldURL = new URL(old.data.url, baseURL)
    const nextURL = new URL(next.url, baseURL)
    assert.deepEqual([...nextURL.searchParams], [...oldURL.searchParams])
    assert.deepEqual(nextURL.searchParams.getAll('tag[]'), ['a', 'b'])
    // Compare decoded keys: Axios and URLSearchParams escape brackets differently.
  })

  test(`${adapter}: JSON body and complete response metadata`, options, async () => {
    const payload = { name: 'Ada', active: true, tags: ['中文', 'fetch'], nullable: null }
    const old = await oldClient().post('/users', payload)
    const next = await npora.postResponse('/users', { json: payload })
    assert.deepEqual(next.data, old.data)
    assert.deepEqual(JSON.parse(next.data.body), payload)
    assert.equal(next.status, old.status)
    assert.equal(next.headers.get('x-migration'), old.headers['x-migration'])
    assert.deepEqual(await next.raw.json(), next.data)
  })

  test(`${adapter}: multipart repeated values and file bytes`, options, async () => {
    const form = () => {
      const value = new FormData()
      value.append('tag', 'one')
      value.append('tag', '中文')
      value.append('file', new Blob(['hello\n世界'], { type: 'text/plain' }), 'note.txt')
      return value
    }
    // Let the transport generate the boundary, including Axios's Fetch adapter.
    const old = await oldClient().post('/upload', form(), {
      headers: { 'Content-Type': null }
    })
    const next = await npora.post('/upload', { body: form() })
    assert.match(old.data.contentType, /^multipart\/form-data; boundary=/)
    assert.match(next.contentType, /^multipart\/form-data; boundary=/)
    assert.deepEqual(next.fields, old.data.fields)
    assert.deepEqual(next.fields, [
      ['tag', 'one'], ['tag', '中文'],
      ['file', { name: 'note.txt', type: 'text/plain', text: 'hello\n世界' }]
    ])
  })

  test(`${adapter}: HTTP failures retain status and parsed payload`, options, async () => {
    await assert.rejects(oldClient().get('/missing'), error => {
      assert.ok(axios.isAxiosError(error))
      assert.equal(error.response.status, 404)
      assert.deepEqual(error.response.data, { message: 'Missing user' })
      return true
    })
    await assert.rejects(npora.get('/missing'), error => {
      assert.ok(isRequestError(error))
      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.status, 404)
      assert.deepEqual(error.data, { message: 'Missing user' })
      return true
    })
  })

  test(`${adapter}: custom status acceptance`, options, async () => {
    const validateStatus = status => status === 404
    const old = await oldClient().get('/missing', { validateStatus })
    const next = await npora.getResponse('/missing', { validateStatus })
    assert.equal(next.status, old.status)
    assert.deepEqual(next.data, old.data)
  })

  test(`${adapter}: cancellation after the server receives the request`, options, async () => {
    for (const library of ['axios', 'npora']) {
      const id = `${adapter}-${library}`
      const controller = new AbortController()
      const received = new Promise(resolve => pending.set(id, resolve))
      const promise = library === 'axios'
        ? oldClient().get('/pending', { params: { id }, signal: controller.signal })
        : npora.get('/pending', { query: { id }, signal: controller.signal })
      // Attach rejection handling before aborting, including assertion failures.
      const rejected = assert.rejects(promise, error => {
        if (library === 'axios') assert.equal(error.code, 'ERR_CANCELED')
        else {
          assert.ok(isRequestError(error))
          assert.equal(error.code, 'ABORT_ERROR')
        }
        return true
      })
      try {
        await Promise.race([
          received,
          promise.then(() => { throw new Error('Pending endpoint unexpectedly completed') })
        ])
        controller.abort()
        await rejected
      } finally {
        controller.abort()
        pending.delete(id)
      }
    }
  })
}
