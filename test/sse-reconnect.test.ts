import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, type ServerSentEvent } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function eventResponse(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' }
  })
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

describe('optional SSE reconnection', () => {
  it.each([false, true])('honors an explicit signal override during reconnect waits (disabled: %s)', async disabled => {
    vi.useFakeTimers()
    const inherited = new AbortController()
    const override = new AbortController()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: first\n\n'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const events = await createClient({ fetch: fetchMock, signal: inherited.signal }).sse('/events', {
      signal: disabled ? undefined : override.signal,
      reconnect: { maxAttempts: 1, delay: 1000 }
    })
    const iterator = events[Symbol.asyncIterator]()
    await iterator.next()
    const pending = iterator.next()
    const outcome = pending.then(() => 'resolved', error => error.code)
    await vi.advanceTimersByTimeAsync(0)
    inherited.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending')

    if (disabled) {
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toMatchObject({ done: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } else {
      override.abort()
      await expect(pending).rejects.toMatchObject({ code: 'ABORT_ERROR' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('cancels reconnect waits with an inherited signal (extended: %s)', async extended => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => eventResponse('data: first\n\n'))
    const parent = createClient({ fetch: fetchMock, signal: controller.signal, totalTimeout: 5000 })
    const client = extended ? parent.extend() : parent
    const events = await client.sse('/events', {
      reconnect: { maxAttempts: 1, delay: 1000 }
    })
    const iterator = events[Symbol.asyncIterator]()
    await iterator.next()
    const pending = iterator.next()
    const outcome = pending.then(() => 'resolved', error => error.code)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    // Cancellation must settle before advancing the reconnect timer.
    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('ABORT_ERROR')
    expect(vi.getTimerCount()).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([204, 205])('returns an empty iterable for HTTP %i', async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status
    }))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events')

    await expect(collect(events)).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops reconnecting when the server returns HTTP 204', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: first\n\n'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      reconnect: { maxAttempts: 3, delay: 0 }
    })

    await expect(collect(events)).resolves.toMatchObject([
      { data: 'first' }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resumes with the latest id, including a control-only event', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse(
        'id: first\ndata: one\n\nid: cursor-only\n\nretry: 0\n\n'
      ))
      .mockResolvedValueOnce(eventResponse('data: two\n\n'))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient({
      baseURL: 'https://example.test',
      headers: { 'last-event-id': 'old' }
    }).sse('/events', { reconnect: { maxAttempts: 1, delay: 0 } })

    await expect(collect(events)).resolves.toMatchObject([
      { data: 'one', id: 'first' },
      { data: 'two', id: 'cursor-only' }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get(
      'last-event-id'
    )).toBe('cursor-only')
  })

  it('preserves SSE request headers and response lifecycle on each connection', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: one\n\n'))
      .mockResolvedValueOnce(eventResponse('data: two\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()
    const responseTypes: Array<string | undefined> = []

    client.interceptors.response.use(response => {
      responseTypes.push(response.config.responseType)
      return response
    })

    const events = await client.sse('/events', {
      reconnect: { maxAttempts: 1, delay: 0 }
    })

    await collect(events)
    expect(responseTypes).toEqual(['sse', 'sse'])
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1].headers).get('accept'))
        .toBe('text/event-stream')
    }
  })

  it('clears an inherited last-event-id when the server clears it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('id:\ndata: first\n\n'))
      .mockResolvedValueOnce(eventResponse('data: second\n\n'))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient({
      baseURL: 'https://example.test',
      headers: { 'last-event-id': 'old' }
    }).sse('/events', { reconnect: { maxAttempts: 1, delay: 0 } })

    await collect(events)
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has(
      'last-event-id'
    )).toBe(false)
  })

  it('stops on a schema error without opening another connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(eventResponse(
      'id: 1\ndata: invalid\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      reconnect: { maxAttempts: 2, delay: 0 },
      itemSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => ({ issues: [{ message: 'invalid' }] })
        }
      }
    })

    await expect(collect(events)).rejects.toMatchObject({
      code: 'SCHEMA_ERROR'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('transforms validated events across connections', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: 1\n\n'))
      .mockResolvedValueOnce(eventResponse('data: 2\n\n'))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      reconnect: { maxAttempts: 1, delay: 0 },
      itemSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: value => ({
            value: Number((value as ServerSentEvent).data)
          })
        }
      }
    })

    await expect(collect(events)).resolves.toEqual([1, 2])
  })

  it('does not reconnect after a 4xx response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: first\n\n'))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      reconnect: { maxAttempts: 3, delay: 0 }
    })

    await expect(collect(events)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 401
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not reconnect after the response size limit is exceeded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(eventResponse(
      'data: oversized\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      maxResponseSize: 5,
      reconnect: { maxAttempts: 3, delay: 0 }
    })

    await expect(collect(events)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient reconnect failure within the attempt limit', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: one\n\n'))
      .mockRejectedValueOnce(new TypeError('connection failed'))
      .mockResolvedValueOnce(eventResponse('data: two\n\n'))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      reconnect: { maxAttempts: 2, delay: 0 }
    })

    await expect(collect(events)).resolves.toMatchObject([
      { data: 'one' },
      { data: 'two' }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('surfaces a 5xx response without reconnecting', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(eventResponse('data: one\n\n'))
      .mockResolvedValueOnce(new Response('unavailable', {
        status: 503,
        headers: { 'content-type': 'text/event-stream' }
      }))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      reconnect: { maxAttempts: 2, delay: 0 }
    })

    await expect(collect(events)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts a pending reconnect delay', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(eventResponse(
      'data: first\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)

    const events = await createClient().sse('/events', {
      signal: controller.signal,
      reconnect: { maxAttempts: 2, delay: 1000 }
    })
    const iterator = events[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: 'first' },
      done: false
    })
    const pending = iterator.next()
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'ABORT_ERROR'
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid reconnect options before network I/O', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createClient().sse('/events', {
      reconnect: { maxAttempts: 0 }
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves the original one-connection behavior by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(eventResponse(
      'data: once\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)

    const events: AsyncIterable<ServerSentEvent> = await createClient()
      .sse('/events')

    await expect(collect(events)).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
