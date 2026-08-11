import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import {
  extname,
  join,
  normalize,
  relative,
  resolve
} from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = 'localhost'
const PORT = 4173

const rootDir = fileURLToPath(
  new URL('../', import.meta.url)
)

const fixtureDir = join(
  rootDir,
  'browser',
  'fixtures'
)

const distDir = join(
  rootDir,
  'dist'
)

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

const requestCounts = new Map()
const downloadFixture = Buffer.alloc(
  64 * 1024,
  0x6e
)

const server = createServer(
  async (request, response) => {
    try {
      const url = new URL(
        request.url ?? '/',
        `http://${HOST}:${PORT}`
      )

      if (request.method === 'OPTIONS') {
        sendPreflight(response)

        return
      }

      if (url.pathname === '/api/user') {
        sendJson(response, 200, {
          id: 1,
          name: 'Npora'
        })

        return
      }

      if (url.pathname === '/api/echo') {
        const body = await readRequestBody(request)

        sendJson(response, 200, {
          method: request.method,
          query: Object.fromEntries(url.searchParams),
          queryEntries: [...url.searchParams.entries()],
          headers: request.headers,
          body: body ? JSON.parse(body) : undefined
        })

        return
      }

      if (url.pathname === '/api/error') {
        sendJson(response, 422, {
          message: 'Invalid browser request'
        })

        return
      }

      if (url.pathname === '/api/slow') {
        await delay(100)

        sendJson(response, 200, {
          ok: true
        })

        return
      }

      if (url.pathname === '/api/download') {
        sendBinary(
          response,
          200,
          downloadFixture
        )

        return
      }

      if (url.pathname === '/api/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*'
        })
        response.write('event: ready\ndata: {"step":1}\n\n')
        await delay(10)
        response.end('event: done\ndata: {"step":2}\n\n')

        return
      }

      if (url.pathname === '/api/records') {
        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*'
        })
        response.write('{"id":1,"name":"你好"}\n')
        await delay(10)
        response.end('{"id":2,"name":"browser"}\n')

        return
      }

      if (url.pathname === '/api/stream-error') {
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': '1024',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*'
        })
        response.write('partial-stream')
        await delay(10)
        response.destroy(new Error('Intentional stream interruption'))

        return
      }

      if (url.pathname === '/api/upload') {
        const body = await readRequestBuffer(request)

        sendJson(response, 200, {
          received: body.byteLength,
          contentType:
            request.headers['content-type']
        })

        return
      }

      if (url.pathname === '/api/count') {
        const key = url.searchParams.get('key') ?? 'default'
        const count = (requestCounts.get(key) ?? 0) + 1
        const cacheControl =
          url.searchParams.get('cache') === 'enabled'
            ? 'max-age=60'
            : 'no-store'

        requestCounts.set(key, count)
        sendJson(
          response,
          200,
          {
            count
          },
          {
            'cache-control': cacheControl
          }
        )

        return
      }

      if (url.pathname === '/favicon.ico') {
        response.writeHead(204, {
          'cache-control': 'no-store',
          'access-control-allow-origin': '*'
        })

        response.end()

        return
      }

      if (url.pathname === '/') {
        await sendFile(
          join(fixtureDir, 'index.html'),
          response
        )

        return
      }

      if (url.pathname.startsWith('/dist/')) {
        const relativePath = normalize(
          url.pathname.replace(/^\/+/, '')
        )

        const requestedPath = resolve(
          rootDir,
          relativePath
        )

        if (
          !isInsideDirectory(
            requestedPath,
            distDir
          )
        ) {
          sendJson(response, 404, {
            message: 'Not Found'
          })

          return
        }

        await sendFile(
          requestedPath,
          response
        )

        return
      }

      sendJson(response, 404, {
        message: 'Not Found'
      })
    } catch (error) {
      console.error(
        'Browser test server request failed:',
        error
      )

      if (!response.headersSent) {
        sendJson(response, 500, {
          message: 'Internal Server Error'
        })

        return
      }

      response.destroy(
        error instanceof Error
          ? error
          : new Error(
            'Unknown server error'
          )
      )
    }
  }
)

server.on('clientError', (error, socket) => {
  console.error(
    'Browser test server client error:',
    error
  )

  if (socket.writable) {
    socket.end(
      'HTTP/1.1 400 Bad Request\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      '\r\n'
    )
  }
})

server.listen(PORT, HOST, () => {
  console.log(
    `Browser test server running at http://${HOST}:${PORT}`
  )
})

async function sendFile(
  filePath,
  response
) {
  try {
    const content = await readFile(filePath)
    const extension = extname(filePath)

    response.writeHead(200, {
      'content-type':
        contentTypes[extension] ??
        'application/octet-stream',

      'content-length':
        String(content.byteLength),

      'cache-control': 'no-store',

      'access-control-allow-origin': '*'
    })

    response.end(content)
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      sendJson(response, 404, {
        message: 'Not Found'
      })

      return
    }

    throw error
  }
}

function sendJson(
  response,
  statusCode,
  data,
  headers = {}
) {
  const content = Buffer.from(
    JSON.stringify(data),
    'utf8'
  )

  response.writeHead(statusCode, {
    'content-type':
      'application/json; charset=utf-8',

    'content-length':
      String(content.byteLength),

    'cache-control': 'no-store',

    'access-control-allow-origin': '*',

    ...headers
  })

  response.end(content)
}

function sendBinary(
  response,
  statusCode,
  content
) {
  response.writeHead(statusCode, {
    'content-type': 'application/octet-stream',
    'content-length': String(content.byteLength),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  })

  response.end(content)
}

function sendPreflight(response) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',

    'access-control-allow-methods':
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',

    'access-control-allow-headers':
      'content-type, authorization',

    'access-control-max-age': '600'
  })

  response.end()
}

async function readRequestBody(request) {
  const content = await readRequestBuffer(request)

  return content.toString('utf8')
}

async function readRequestBuffer(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    )
  }

  return Buffer.concat(chunks)
}

function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  })
}

function isInsideDirectory(
  filePath,
  directory
) {
  const relativePath = relative(
    directory,
    filePath
  )

  return (
    relativePath === '' ||
    (
      !relativePath.startsWith('..') &&
      !relativePath.includes(
        `..${
          process.platform === 'win32'
            ? '\\'
            : '/'
        }`
      )
    )
  )
}

function shutdown(signal) {
  console.log(
    `Received ${signal}, closing browser test server.`
  )

  server.close(error => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', () => {
  shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  shutdown('SIGTERM')
})
