import {
  isRequestError,
  RequestError
} from '../errors'
import type {
  NporaResponse,
  RequestConfig,
  ServerSentEvent,
  StreamingSchemaLocation
} from '../types'
import { validateStandardSchemaValue } from './validateStandardSchema'

interface StreamingParserContext {
  config: RequestConfig
  response: Response
}

/**
 * Decode a server-sent event response without buffering the complete body.
 */
export function parseServerSentEvents<T = ServerSentEvent>(
  response: Response,
  config: RequestConfig
): AsyncIterable<T> {
  return decodeServerSentEvents<T>(response.body, {
    config,
    response
  })
}

/**
 * Decode a newline-delimited JSON response without buffering the complete
 * body.
 */
export function parseNdjson<T>(
  response: Response,
  config: RequestConfig
): AsyncIterable<T> {
  return decodeNdjson<T>(response.body, {
    config,
    response
  })
}

async function* decodeServerSentEvents<T>(
  stream: ReadableStream<Uint8Array> | null,
  context: StreamingParserContext
): AsyncGenerator<T> {
  let data: string[] = []
  let event = ''
  let lastEventId = ''
  let retry: number | undefined
  let itemIndex = 0

  for await (const line of decodeLines(stream, context)) {
    if (line === '') {
      if (data.length > 0) {
        const item: ServerSentEvent = {
          data: data.join('\n'),
          event: event || 'message',
          id: lastEventId,
          ...(retry === undefined ? {} : { retry })
        }

        yield await validateStreamingItem<T>(item, context, {
          itemIndex,
          event: item.event,
          eventId: item.id
        }, 'SSE')
        itemIndex += 1
      }

      data = []
      event = ''
      continue
    }

    if (line.startsWith(':')) {
      continue
    }

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)

    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    switch (field) {
      case 'data':
        data.push(value)
        break

      case 'event':
        event = value
        break

      case 'id':
        if (!value.includes('\0')) {
          lastEventId = value
        }
        break

      case 'retry':
        if (/^\d+$/.test(value)) {
          const milliseconds = Number(value)

          if (Number.isSafeInteger(milliseconds)) {
            retry = milliseconds
          }
        }
        break
    }
  }
}

async function* decodeNdjson<T>(
  stream: ReadableStream<Uint8Array> | null,
  context: StreamingParserContext
): AsyncGenerator<T> {
  let lineNumber = 0
  let itemIndex = 0

  for await (const line of decodeLines(stream, context)) {
    lineNumber += 1

    if (line.trim() === '') {
      continue
    }

    try {
      const item = JSON.parse(line) as unknown

      yield await validateStreamingItem<T>(item, context, {
        itemIndex,
        lineNumber
      }, 'NDJSON')
      itemIndex += 1
    } catch (error) {
      if (isRequestError(error)) {
        throw error
      }

      throw parserError(
        `Failed to parse NDJSON at line ${lineNumber}`,
        context,
        error
      )
    }
  }
}

async function validateStreamingItem<T>(
  item: unknown,
  context: StreamingParserContext,
  location: StreamingSchemaLocation,
  kind: 'SSE' | 'NDJSON'
): Promise<T> {
  const schema = context.config.itemSchema

  if (!schema) {
    return item as T
  }

  const response: NporaResponse<unknown> = {
    data: item,
    status: context.response.status,
    statusText: context.response.statusText,
    headers: context.response.headers,
    config: context.config,
    raw: context.response
  }
  const locationText = kind === 'NDJSON'
    ? `item ${location.itemIndex + 1} at line ${location.lineNumber}`
    : `item ${location.itemIndex + 1}`

  return await validateStandardSchemaValue(
    schema,
    item,
    response,
    {
      failed: `${kind} ${locationText} schema validator failed`,
      invalid: `${kind} ${locationText} schema validator returned an invalid result`,
      rejected: `${kind} ${locationText} schema validation failed`,
      location
    }
  ) as T
}

async function* decodeLines(
  stream: ReadableStream<Uint8Array> | null,
  context: StreamingParserContext
): AsyncGenerator<string> {
  if (!stream) {
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let completed = false

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) {
        completed = true
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(result.value, { stream: true })
      let start = 0

      for (let index = 0; index < buffer.length; index += 1) {
        const character = buffer[index]

        if (character === '\n') {
          yield buffer.slice(start, index)
          start = index + 1
          continue
        }

        if (character !== '\r') {
          continue
        }

        // Preserve a trailing CR until the next chunk so a split CRLF is
        // emitted as one line ending.
        if (index + 1 === buffer.length) {
          break
        }

        yield buffer.slice(start, index)

        if (buffer[index + 1] === '\n') {
          index += 1
        }

        start = index + 1
      }

      buffer = buffer.slice(start)
    }

    let start = 0

    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index]

      if (character !== '\n' && character !== '\r') {
        continue
      }

      yield buffer.slice(start, index)

      if (character === '\r' && buffer[index + 1] === '\n') {
        index += 1
      }

      start = index + 1
    }

    if (start < buffer.length) {
      yield buffer.slice(start)
    }
  } catch (error) {
    if (isRequestError(error)) {
      throw error
    }

    throw parserError(
      'Failed to parse streaming response',
      context,
      error
    )
  } finally {
    try {
      if (!completed) {
        await reader.cancel()
      }
    } catch {
      // Preserve the parser result or original stream error.
    } finally {
      reader.releaseLock()
    }
  }
}

function parserError(
  message: string,
  context: StreamingParserContext,
  cause: unknown
): RequestError {
  return new RequestError(message, {
    code: 'PARSER_ERROR',
    status: context.response.status,
    config: context.config,
    cause
  })
}
