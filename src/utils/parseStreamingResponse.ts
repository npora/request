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
import type { SseControlObserver } from './sseControl'
import { withEarlyIteratorCleanup } from './withEarlyIteratorCleanup'
import { createAbortError } from './createAbortError'

const encoder = new TextEncoder()

interface StreamingParserContext {
  config: RequestConfig
  response: Response
  signal?: AbortSignal | null
  start(): void
}

/**
 * Decode a server-sent event response without buffering the complete body.
 */
export function parseServerSentEvents<T = ServerSentEvent>(
  response: Response,
  config: RequestConfig,
  observer?: SseControlObserver,
  signal = config.signal
): AsyncIterable<T> {
  return withEarlyIteratorCleanup(start => decodeServerSentEvents<T>(response.body, {
    config,
    response,
    signal,
    start
  }, observer), () => response.body?.cancel())
}

/**
 * Decode a newline-delimited JSON response without buffering the complete
 * body.
 */
export function parseNdjson<T>(
  response: Response,
  config: RequestConfig,
  signal = config.signal
): AsyncIterable<T> {
  return withEarlyIteratorCleanup(start => decodeNdjson<T>(response.body, {
    config,
    response,
    signal,
    start
  }), () => response.body?.cancel())
}

async function* decodeServerSentEvents<T>(
  stream: ReadableStream<Uint8Array> | null,
  context: StreamingParserContext,
  observer?: SseControlObserver
): AsyncGenerator<T> {
  context.start()
  let data: string[] = []
  let event = ''
  let lastEventId = observer?.initialId ?? ''
  let retry: number | undefined = observer?.initialRetry
  let itemIndex = 0

  for await (const line of decodeLines(stream, context, true)) {
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
          observer?.onId?.(value)
        }
        break

      case 'retry':
        if (/^\d+$/.test(value)) {
          const milliseconds = Number(value)

          if (Number.isSafeInteger(milliseconds)) {
            retry = milliseconds
            observer?.onRetry?.(milliseconds)
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
  context.start()
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
  checkSignal(context)
  const schema = context.config.itemSchema

  if (!schema) {
    return item as T
  }

  const response: NporaResponse<unknown> = {
    data: item,
    status: context.response.status,
    statusText: context.response.statusText,
    headers: context.response.headers,
    config: context.signal && context.signal !== context.config.signal
      ? {
          ...context.config,
          signal: context.config.signal
            ? AbortSignal.any([context.config.signal, context.signal])
            : context.signal
        }
      : context.config,
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
  context: StreamingParserContext,
  sse = false
): AsyncGenerator<string> {
  if (!stream) {
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let fragments: string[] = []
  let skipLF = false
  let completed = false
  let fragmentSize = 0
  let eventSize = 0
  let streamError: unknown
  void reader.closed.catch(error => { streamError = error })
  const check = () => {
    checkSignal(context)
    if (streamError !== undefined) throw streamError
  }
  const lineLimit = context.config.maxStreamLineSize
  const eventLimit = sse ? context.config.maxSseEventSize : undefined
  const measure = (text: string) => {
    if (Number.isFinite(lineLimit) || Number.isFinite(eventLimit)) {
      fragmentSize += encoder.encode(text).byteLength
      checkSize(fragmentSize, lineLimit, 'maxStreamLineSize', context)
      checkSize(eventSize + fragmentSize, eventLimit, 'maxSseEventSize', context)
    }
  }

  try {
    while (true) {
      check()
      const result = await reader.read()
      check()
      completed = result.done
      const chunk = completed
        ? decoder.decode()
        : decoder.decode(result.value, { stream: true })
      let start = 0

      // A CR already ended the previous line. Ignore only its paired LF,
      // preserving this state across empty chunks and partial UTF-8 reads.
      if (skipLF && chunk.length > 0) {
        if (chunk[0] === '\n') start = 1
        skipLF = false
      }

      for (let index = start; index < chunk.length; index += 1) {
        const character = chunk[index]
        if (character !== '\n' && character !== '\r') continue

        let line = chunk.slice(start, index)
        measure(line)
        if (fragments.length > 0) {
          fragments.push(line)
          line = fragments.join('')
          fragments = []
        }

        if (character === '\r') {
          if (chunk[index + 1] === '\n') index += 1
          else if (index + 1 === chunk.length) skipLF = true
        }
        start = index + 1
        eventSize = line === '' ? 0 : eventSize + fragmentSize
        check()
        yield line
        fragmentSize = 0
      }

      // Keep unfinished lines as fragments instead of concatenating and
      // rescanning the growing prefix on every read.
      if (start < chunk.length) {
        const tail = chunk.slice(start)
        measure(tail)
        fragments.push(tail)
      }
      if (completed) break
    }

    check()
    if (fragments.length > 0) yield fragments.join('')
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
        // A source's cancellation hook may never settle. Release ownership
        // and preserve the parser result without waiting for external cleanup.
        void reader.cancel().catch(() => {})
      }
    } catch {
      // Preserve the parser result or original stream error.
    } finally {
      reader.releaseLock()
    }
  }
}

function checkSignal(context: StreamingParserContext): void {
  if (context.config.signal?.aborted) {
    throw createAbortError(context.config.signal.reason, context.config)
  }
  if (context.signal?.aborted) {
    throw createAbortError(context.signal.reason, context.config)
  }
}

function checkSize(
  size: number,
  maximum: number | undefined,
  option: string,
  context: StreamingParserContext
): void {
  if (maximum !== undefined && size > maximum) {
    throw new RequestError(`Streaming response exceeds ${option} ${maximum}`, {
      code: 'RESPONSE_TOO_LARGE', status: context.response.status, config: context.config
    })
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
