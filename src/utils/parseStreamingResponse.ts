import { RequestError } from '../errors'
import type {
  RequestConfig,
  ServerSentEvent
} from '../types'

interface StreamingParserContext {
  config: RequestConfig
  response: Response
}

/**
 * Decode a server-sent event response without buffering the complete body.
 */
export function parseServerSentEvents(
  response: Response,
  config: RequestConfig
): AsyncIterable<ServerSentEvent> {
  return decodeServerSentEvents(response.body, {
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

async function* decodeServerSentEvents(
  stream: ReadableStream<Uint8Array> | null,
  context: StreamingParserContext
): AsyncGenerator<ServerSentEvent> {
  let data: string[] = []
  let event = ''
  let lastEventId = ''
  let retry: number | undefined

  for await (const line of decodeLines(stream, context)) {
    if (line === '') {
      if (data.length > 0) {
        yield {
          data: data.join('\n'),
          event: event || 'message',
          id: lastEventId,
          ...(retry === undefined ? {} : { retry })
        }
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

  for await (const line of decodeLines(stream, context)) {
    lineNumber += 1

    if (line.trim() === '') {
      continue
    }

    try {
      yield JSON.parse(line) as T
    } catch (error) {
      throw parserError(
        `Failed to parse NDJSON at line ${lineNumber}`,
        context,
        error
      )
    }
  }
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
      const lines = takeCompleteLines(buffer, false)

      buffer = lines.rest

      for (const line of lines.values) {
        yield line
      }
    }

    const lines = takeCompleteLines(buffer, true)

    for (const line of lines.values) {
      yield line
    }

    if (lines.rest !== '') {
      yield lines.rest
    }
  } catch (error) {
    if (error instanceof RequestError) {
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

function takeCompleteLines(
  input: string,
  ended: boolean
): { values: string[]; rest: string } {
  const values: string[] = []
  let start = 0

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]

    if (character === '\n') {
      values.push(input.slice(start, index))
      start = index + 1
      continue
    }

    if (character !== '\r') {
      continue
    }

    if (index + 1 === input.length && !ended) {
      break
    }

    values.push(input.slice(start, index))

    if (input[index + 1] === '\n') {
      index += 1
    }

    start = index + 1
  }

  return {
    values,
    rest: input.slice(start)
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
