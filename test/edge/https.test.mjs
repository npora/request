import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'node:https'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { createClient } from '../../dist/core.js'
import { downloadPlugin } from '../../dist/plugins/download.js'

// Ephemeral synthetic credentials: never checked in or copied into reports.
const directory = mkdtempSync(join(tmpdir(), 'request-https-'))
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
    '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
} catch (error) {
  rmSync(directory, { recursive: true, force: true })
  throw error
}
const key = readFileSync(join(directory, 'key.pem'))
const cert = readFileSync(join(directory, 'cert.pem'))
after(() => rmSync(directory, { recursive: true, force: true }))

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

for (const module of ['undici', 'undici-next']) {
  test(`${module}: real HTTPS lifecycle, compression and certificate boundaries`, { timeout: 20000 }, async t => {
    const { Agent, ProxyAgent, fetch: transport } = await import(module)
    const plain = Buffer.from('{"ok":true}')
    const compressed = gzipSync(plain)
    let uploadBytes = 0
    const server = createServer({ key, cert }, async (request, response) => {
      if (request.url === '/upload') {
        try {
          for await (const chunk of request) uploadBytes += chunk.length
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ bytes: uploadBytes }))
        } catch { /* Expected when a streaming upload is cancelled. */ }
        return
      }
      if (request.url === '/slow') return
      if (request.url === '/broken') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' })
        response.write('first')
        const timer = setTimeout(() => response.destroy(), 30)
        response.once('close', () => clearTimeout(timer))
        return
      }
      if (request.url === '/expanded') {
        const body = gzipSync(Buffer.alloc(65536, 42))
        response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length })
        response.end(body)
        return
      }
      const status = request.url === '/error' ? 400 : 200
      response.writeHead(status, { 'content-type': 'application/json',
        'content-encoding': 'gzip', 'content-length': compressed.length })
      response.end(compressed)
    })
    const port = await listen(server)
    const dispatcher = new Agent({ connections: 1, connect: { ca: cert } })
    const client = createClient({ baseURL: `https://127.0.0.1:${port}`,
      fetch: (input, init) => {
        // Standalone Undici does not accept Node's built-in Request brand.
        if (input instanceof Request) {
          init = { method: input.method, headers: input.headers, body: input.body,
            signal: input.signal, cache: input.cache, credentials: input.credentials,
            integrity: input.integrity, keepalive: input.keepalive, mode: input.mode,
            redirect: input.redirect, referrer: input.referrer, referrerPolicy: input.referrerPolicy,
            duplex: 'half', ...init }
          input = input.url
        }
        return transport(input, { ...init, dispatcher })
      } })
    try {
      await t.test('trusted TLS and decoded download progress', async () => {
        const progress = []
        const api = client.extend().use(downloadPlugin({ transport: 'fetch' }))
        const blob = await api.get('/gzip', { extensions: { download: {
          onProgress: value => progress.push(value)
        } } })
        assert.equal(await blob.text(), plain.toString())
        assert.equal(progress.at(-1).loaded, plain.length)
        assert.ok(progress.every(value => value.total === undefined))
      })
      await t.test('decoded size limit accepts gzip overhead', async () => {
        assert.ok(compressed.length > plain.length)
        assert.deepEqual(await client.get('/gzip', { maxResponseSize: plain.length }), { ok: true })
        await assert.rejects(client.get('/gzip', { maxResponseSize: plain.length - 1 }), { code: 'RESPONSE_TOO_LARGE' })
      })
      await t.test('compressed HTTP error retains a small decoded body', async () => {
        await assert.rejects(client.get('/error', { maxErrorResponseSize: plain.length }), error => {
          assert.equal(error.code, 'HTTP_ERROR')
          assert.deepEqual(error.response.data, { ok: true })
          return true
        })
      })
      await t.test('compressed expansion is bounded by decoded bytes', async () => {
        await assert.rejects(client.get('/expanded', { responseType: 'bytes', maxResponseSize: 1024 }), { code: 'RESPONSE_TOO_LARGE' })
        assert.deepEqual(await client.get('/gzip'), { ok: true })
      })
      await t.test('slow native Request upload keeps bytes intact', async () => {
        let chunks = 0
        const body = new ReadableStream({ async pull(controller) {
          await new Promise(resolve => setTimeout(resolve, 5))
          if (chunks++ === 8) controller.close()
          else controller.enqueue(new Uint8Array(1024).fill(42))
        } })
        const result = await client.request(new Request(`https://127.0.0.1:${port}/upload`, {
          method: 'POST', body, duplex: 'half'
        }))
        assert.deepEqual(result, { bytes: 8192 })
      })
      await t.test('timeout and interrupted download release the connection pool', async () => {
        await assert.rejects(client.get('/slow', { timeout: 30 }), { code: 'TIMEOUT_ERROR' })
        const stream = await client.get('/broken', { responseType: 'stream' })
        const reader = stream.getReader()
        assert.equal(new TextDecoder().decode((await reader.read()).value), 'first')
        await assert.rejects(reader.read())
        reader.releaseLock()
        assert.deepEqual(await client.get('/gzip'), { ok: true })
      })
      await t.test('cancel a slow upload and stop producing bytes', async () => {
        const controller = new AbortController()
        let produced = 0
        let cancelled = false
        const body = new ReadableStream({ async pull(stream) {
          await new Promise(resolve => setTimeout(resolve, 5))
          if (controller.signal.aborted || produced === 20) {
            cancelled = true
            stream.close()
          } else if (!cancelled) { produced++; stream.enqueue(new Uint8Array(1024)) }
        }, cancel() { cancelled = true } })
        const pending = client.post('/upload', { body, signal: controller.signal })
        const rejection = assert.rejects(pending, { code: 'ABORT_ERROR' })
        while (produced < 2) await new Promise(resolve => setTimeout(resolve, 5))
        controller.abort()
        await rejection
        await new Promise(resolve => setTimeout(resolve, 30))
        assert.equal(cancelled, true)
        const stopped = produced
        await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(produced, stopped)
        assert.deepEqual(await client.get('/gzip'), { ok: true })
      })
      await t.test('untrusted certificate fails without disabling verification', async () => {
        const untrusted = new Agent()
        try {
          await assert.rejects(createClient({ fetch: (input, init) => transport(input, { ...init, dispatcher: untrusted }) })
            .get(`https://127.0.0.1:${port}/gzip`), { code: 'NETWORK_ERROR' })
        } finally { await untrusted.destroy() }
      })
      await t.test('CONNECT proxy keeps target TLS verification enabled', async () => {
        let tunnels = 0
        const sockets = new Set()
        const proxy = httpServer()
        proxy.on('connect', (request, socket, head) => {
          if (request.url !== `127.0.0.1:${port}`) return socket.destroy()
          tunnels++
          const upstream = connect(port, '127.0.0.1', () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            if (head.length) upstream.write(head)
            socket.pipe(upstream).pipe(socket)
          })
          for (const connection of [socket, upstream]) {
            sockets.add(connection)
            connection.on('error', () => { socket.destroy(); upstream.destroy() })
            connection.once('close', () => sockets.delete(connection))
          }
        })
        const proxyPort = await listen(proxy)
        const agent = new ProxyAgent({ uri: `http://127.0.0.1:${proxyPort}`, requestTls: { ca: cert } })
        try {
          const api = createClient({ fetch: (input, init) => transport(input, { ...init, dispatcher: agent }) })
          assert.deepEqual(await api.get(`https://127.0.0.1:${port}/gzip`), { ok: true })
          assert.equal(tunnels, 1)
        } finally {
          await agent.destroy()
          for (const socket of sockets) socket.destroy()
          await close(proxy)
        }
      })
    } finally {
      await dispatcher.destroy()
      await close(server)
    }
  })
}
