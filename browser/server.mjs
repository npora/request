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

const HOST = '127.0.0.1'
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
  data
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
