import { RequestError } from '../errors'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'
import type { RequestConfig } from '../types'
import type { Plugin } from './Plugin'
import { resolveRequestOrigin } from '../utils/resolveRequestOrigin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export interface ConcurrencyPluginOptions {
  /**
   * Maximum active logical requests for each isolation key.
   *
   * @default 10
   */
  maxConcurrent?: number

  /**
   * Maximum queued requests for each isolation key.
   * Set to zero to reject instead of waiting.
   *
   * @default 1000
   */
  maxQueue?: number

  /**
   * Maximum time in milliseconds a request may wait for a permit.
   *
   * @default 30000
   */
  queueTimeout?: number

  /**
   * Maximum inactive isolation states retained by this plugin instance.
   * Active and queued states are never evicted and may temporarily exceed
   * the limit.
   *
   * @default 1000
   */
  maxKeys?: number

  /**
   * Create the default isolation key for a request.
   *
   * @default the resolved request origin or "default"
   */
  createKey?: (config: RequestConfig) => string
}

export interface ConcurrencyState {
  active: number
  queued: number
}

export interface ConcurrencyPlugin extends Plugin {
  getState(key: string): Readonly<ConcurrencyState>
}

interface ConcurrencyRecord {
  key: string
  active: number
  head?: QueueEntry
  tail?: QueueEntry
  size: number
}

interface QueueEntry {
  context: object
  config: RequestConfig
  prev?: QueueEntry
  next?: QueueEntry
  linked: boolean
  resolve(): void
  reject(error: unknown): void
}

interface NormalizedOptions {
  maxConcurrent: number
  maxQueue: number
  queueTimeout: number
  maxKeys: number
  createKey: (config: RequestConfig) => string
}

export function concurrencyPlugin(
  options: ConcurrencyPluginOptions = {}
): ConcurrencyPlugin {
  const normalized = normalizeOptions(options)
  const records = new Map<string, ConcurrencyRecord>()

  return {
    name: 'concurrency',

    getState(key) {
      const record = records.get(normalizeKey(key))

      return {
        active: record?.active ?? 0,
        queued: record?.size ?? 0
      }
    },

    install(context) {
      const admissions = new WeakMap<object, ConcurrencyRecord>()
      let active = true

      context.hooks.onRequest(requestContext => {
        const requestOptions = resolveExtensionConfig(
          requestContext.config,
          'concurrency'
        )

        if (requestOptions?.enabled === false) {
          return
        }

        const key = normalizeKey(
          requestOptions?.key ?? normalized.createKey(requestContext.config)
        )
        const record = getRecord(records, key, normalized.maxKeys)

        if (record.active < normalized.maxConcurrent) {
          record.active += 1
          admissions.set(requestContext, record)
          return
        }

        if (requestContext.config.signal?.aborted) {
          throw createAbortError(
            requestContext.config.signal.reason,
            requestContext.config
          )
        }

        if (record.size >= normalized.maxQueue) {
          throw createLimitError(
            'Concurrency queue is full',
            requestContext.config
          )
        }

        const timeout = normalizeDuration(
          requestOptions?.queueTimeout,
          normalized.queueTimeout
        )

        return enqueue(record, requestContext, timeout).then(() => {
          if (!active) {
            throw createRemovedError(requestContext.config)
          }
        })
      })

      context.hooks.onSettled(requestContext => {
        const record = admissions.get(requestContext)

        if (!record) {
          return
        }

        admissions.delete(requestContext)

        if (!active || records.get(record.key) !== record) {
          return
        }

        releaseNext(record, entry => {
          admissions.set(entry.context, record)
          entry.resolve()
        })

        if (
          record.active === 0 &&
          record.size === 0
        ) {
          touchRecord(records, record.key, record)
          trimRecords(records, normalized.maxKeys)
        }
      })

      return () => {
        active = false

        for (const record of records.values()) {
          let entry: QueueEntry | undefined

          while ((entry = shiftQueue(record))) {
            entry.reject(createRemovedError(entry.config))
          }
        }

        records.clear()
      }
    }
  }
}

function enqueue(
  record: ConcurrencyRecord,
  context: {
    config: RequestConfig
  },
  timeout: number
): Promise<void> {
  const { config } = context
  const signal = config.signal

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason, config))
  }

  if (timeout <= 0) {
    return Promise.reject(
      createLimitError('Concurrency queue wait timed out', config)
    )
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const remove = () => removeQueuedEntry(record, entry)
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }

      try {
        signal?.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup failures must not retain a queue entry.
      }
    }
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }
    const resolveOnce = () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve()
    }
    const onAbort = () => {
      remove()
      rejectOnce(createAbortError(signal?.reason, config))
    }
    const entry: QueueEntry = {
      context,
      config,
      linked: false,
      resolve: resolveOnce,
      reject: rejectOnce
    }

    try {
      signal?.addEventListener('abort', onAbort, {
        once: true
      })
    } catch (error) {
      rejectOnce(error)
      return
    }

    if (signal?.aborted) {
      onAbort()
    }

    if (settled) {
      return
    }

    if (Number.isFinite(timeout)) {
      try {
        timer = setTimeout(() => {
          remove()
          rejectOnce(
            createLimitError('Concurrency queue wait timed out', config)
          )
        }, timeout)
      } catch (error) {
        rejectOnce(error)
        return
      }

      if (settled) {
        clearTimeout(timer)
        timer = undefined
        return
      }
    }

    appendQueue(record, entry)
  })
}

function releaseNext(
  record: ConcurrencyRecord,
  grant: (entry: QueueEntry) => void
): void {
  const next = shiftQueue(record)

  if (next) {
    grant(next)
    return
  }

  record.active = Math.max(0, record.active - 1)
}

function getRecord(
  records: Map<string, ConcurrencyRecord>,
  key: string,
  maxKeys: number
): ConcurrencyRecord {
  const existing = records.get(key)

  if (existing) {
    return existing
  }

  trimRecords(records, Math.max(0, maxKeys - 1))

  const record: ConcurrencyRecord = {
    key,
    active: 0,
    size: 0
  }

  records.set(key, record)
  return record
}

function touchRecord(
  records: Map<string, ConcurrencyRecord>,
  key: string,
  record: ConcurrencyRecord
): void {
  records.delete(key)
  records.set(key, record)
}

function trimRecords(
  records: Map<string, ConcurrencyRecord>,
  maxKeys: number
): void {
  if (records.size <= maxKeys) {
    return
  }

  for (const [key, record] of records) {
    if (records.size <= maxKeys) {
      return
    }

    if (record.active === 0 && record.size === 0) {
      records.delete(key)
    }
  }
}

function appendQueue(
  record: ConcurrencyRecord,
  entry: QueueEntry
): void {
  entry.prev = record.tail
  entry.next = undefined
  entry.linked = true

  if (record.tail) {
    record.tail.next = entry
  } else {
    record.head = entry
  }

  record.tail = entry
  record.size += 1
}

function shiftQueue(
  record: ConcurrencyRecord
): QueueEntry | undefined {
  const entry = record.head

  if (entry) {
    removeQueuedEntry(record, entry)
  }

  return entry
}

function removeQueuedEntry(
  record: ConcurrencyRecord,
  entry: QueueEntry
): void {
  if (!entry.linked) {
    return
  }

  const { prev, next } = entry

  if (prev) {
    prev.next = next
  } else {
    record.head = next
  }

  if (next) {
    next.prev = prev
  } else {
    record.tail = prev
  }

  entry.prev = undefined
  entry.next = undefined
  entry.linked = false
  record.size -= 1
}

function normalizeOptions(
  options: ConcurrencyPluginOptions
): NormalizedOptions {
  return {
    maxConcurrent: normalizePositiveInteger(options.maxConcurrent, 10),
    maxQueue: normalizeNonNegativeInteger(options.maxQueue, 1000),
    queueTimeout: normalizeDuration(options.queueTimeout, 30000),
    maxKeys: normalizePositiveInteger(options.maxKeys, 1000),
    createKey: options.createKey ?? resolveRequestOrigin
  }
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.floor(value))
}

function normalizeDuration(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.POSITIVE_INFINITY : 0
  }

  return Math.min(Math.max(0, value), MAX_TIMER_DELAY)
}

function normalizeKey(key: string): string {
  const normalized = String(key).trim()

  return normalized || 'default'
}

function createLimitError(
  message: string,
  config: RequestConfig
): RequestError {
  return new RequestError(message, {
    code: 'CONCURRENCY_LIMIT',
    config
  })
}

function createAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  return new RequestError(
    'Request aborted while waiting for concurrency permit',
    {
      code: 'ABORT_ERROR',
      config,
      cause: reason
    }
  )
}

function createRemovedError(config: RequestConfig): RequestError {
  return new RequestError(
    'Concurrency plugin removed while request was queued',
    {
      code: 'ABORT_ERROR',
      config
    }
  )
}
