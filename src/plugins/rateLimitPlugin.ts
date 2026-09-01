import { RequestError } from '../errors'
import type { RequestConfig } from '../types'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'
import { resolveRequestOrigin } from '../utils/resolveRequestOrigin'

export interface RateLimitPluginOptions {
  /** Maximum transport attempts admitted during each rolling interval. */
  maxRequests?: number

  /** Rolling interval in milliseconds. @default 1000 */
  interval?: number

  /** Maximum queued attempts for each isolation key. @default 1000 */
  maxQueue?: number

  /** Maximum queue wait in milliseconds. @default 30000 */
  queueTimeout?: number

  /** Maximum inactive isolation states retained. @default 1000 */
  maxKeys?: number

  /** @default the resolved request origin or "default" */
  createKey?: (config: RequestConfig) => string
}

export interface RateLimitState {
  remaining: number
  queued: number
  resetAt?: number
}

export interface RateLimitPlugin extends Plugin {
  getState(key: string): Readonly<RateLimitState>
}

interface RateLimitRecord {
  key: string
  timestamps: number[]
  timestampHead: number
  head?: QueueEntry
  tail?: QueueEntry
  size: number
  timer?: ReturnType<typeof setTimeout>
}

interface QueueEntry {
  config: RequestConfig
  prev?: QueueEntry
  next?: QueueEntry
  linked: boolean
  resolve(): void
  reject(error: unknown): void
}

interface NormalizedOptions {
  maxRequests: number
  interval: number
  maxQueue: number
  queueTimeout: number
  maxKeys: number
  createKey: (config: RequestConfig) => string
}

export function rateLimitPlugin(
  options: RateLimitPluginOptions = {}
): RateLimitPlugin {
  const normalized = normalizeOptions(options)
  const records = new Map<string, RateLimitRecord>()

  return {
    name: 'rate-limit',

    getState(key) {
      const record = records.get(normalizeKey(key))

      if (!record) {
        return {
          remaining: normalized.maxRequests,
          queued: 0
        }
      }

      const now = Date.now()

      pruneTimestamps(record, now, normalized.interval)

      return createState(record, normalized, now)
    },

    install(context) {
      let active = true

      context.hooks.onTransport(requestContext => {
        const requestOptions = resolveExtensionConfig(
          requestContext.config,
          'rateLimit'
        )

        if (requestOptions?.enabled === false) {
          return
        }

        const key = normalizeKey(
          requestOptions?.key ?? normalized.createKey(requestContext.config)
        )
        const now = Date.now()
        const record = getRecord(
          records,
          key,
          normalized.maxKeys,
          now,
          normalized.interval
        )

        pruneTimestamps(record, now, normalized.interval)

        if (
          record.size === 0 &&
          activeCount(record) < normalized.maxRequests
        ) {
          record.timestamps.push(now)
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
            'Rate limit queue is full',
            requestContext.config
          )
        }

        const timeout = normalizeDuration(
          requestOptions?.queueTimeout,
          normalized.queueTimeout
        )

        return enqueue(record, requestContext.config, timeout, () => {
          schedule(record, records, normalized, active)
        }).then(() => {
          if (!active) {
            throw createRemovedError(requestContext.config)
          }
        })
      })

      return () => {
        active = false

        for (const record of records.values()) {
          clearRecordTimer(record)

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
  record: RateLimitRecord,
  config: RequestConfig,
  timeout: number,
  onQueued: () => void
): Promise<void> {
  const signal = config.signal

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason, config))
  }

  if (timeout <= 0) {
    return Promise.reject(
      createLimitError('Rate limit queue wait timed out', config)
    )
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
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
      removeQueuedEntry(record, entry)
      rejectOnce(createAbortError(signal?.reason, config))
    }
    const entry: QueueEntry = {
      config,
      linked: false,
      resolve: resolveOnce,
      reject: rejectOnce
    }

    try {
      signal?.addEventListener('abort', onAbort, { once: true })
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
          removeQueuedEntry(record, entry)
          rejectOnce(
            createLimitError('Rate limit queue wait timed out', config)
          )
        }, timeout)
      } catch (error) {
        rejectOnce(error)
        return
      }
    }

    appendQueue(record, entry)

    try {
      onQueued()
    } catch (error) {
      removeQueuedEntry(record, entry)
      rejectOnce(error)
    }
  })
}

function schedule(
  record: RateLimitRecord,
  records: Map<string, RateLimitRecord>,
  options: NormalizedOptions,
  active: boolean
): void {
  if (!active || record.size === 0 || record.timer !== undefined) {
    return
  }

  const now = Date.now()

  pruneTimestamps(record, now, options.interval)

  if (activeCount(record) < options.maxRequests) {
    drain(record, records, options, active, now)
    return
  }

  const resetAt = (record.timestamps[record.timestampHead] ?? now) +
    options.interval
  const delay = Math.max(0, Math.min(resetAt - now, MAX_TIMER_DELAY))

  record.timer = setTimeout(() => {
    record.timer = undefined
    drain(record, records, options, active, Date.now())
  }, delay)
}

function drain(
  record: RateLimitRecord,
  records: Map<string, RateLimitRecord>,
  options: NormalizedOptions,
  active: boolean,
  now: number
): void {
  if (!active || records.get(record.key) !== record) {
    return
  }

  pruneTimestamps(record, now, options.interval)

  while (
    record.size > 0 &&
    activeCount(record) < options.maxRequests
  ) {
    const entry = shiftQueue(record)

    if (!entry) {
      break
    }

    record.timestamps.push(now)
    entry.resolve()
  }

  schedule(record, records, options, active)
}

function pruneTimestamps(
  record: RateLimitRecord,
  now: number,
  interval: number
): void {
  const threshold = now - interval

  while (
    record.timestampHead < record.timestamps.length &&
    (record.timestamps[record.timestampHead] ?? 0) <= threshold
  ) {
    record.timestampHead += 1
  }

  if (
    record.timestampHead >= 1024 &&
    record.timestampHead * 2 >= record.timestamps.length
  ) {
    record.timestamps = record.timestamps.slice(record.timestampHead)
    record.timestampHead = 0
  }
}

function activeCount(record: RateLimitRecord): number {
  return record.timestamps.length - record.timestampHead
}

function createState(
  record: RateLimitRecord,
  options: NormalizedOptions,
  now: number
): RateLimitState {
  const count = activeCount(record)
  const resetAt = count > 0
    ? (record.timestamps[record.timestampHead] ?? now) + options.interval
    : undefined

  return {
    remaining: Math.max(0, options.maxRequests - count),
    queued: record.size,
    ...(resetAt === undefined ? {} : { resetAt })
  }
}

function getRecord(
  records: Map<string, RateLimitRecord>,
  key: string,
  maxKeys: number,
  now: number,
  interval: number
): RateLimitRecord {
  const existing = records.get(key)

  if (existing) {
    return existing
  }

  trimRecords(records, Math.max(0, maxKeys - 1), now, interval)

  const record: RateLimitRecord = {
    key,
    timestamps: [],
    timestampHead: 0,
    size: 0
  }

  records.set(key, record)
  return record
}

function trimRecords(
  records: Map<string, RateLimitRecord>,
  maxKeys: number,
  now: number,
  interval: number
): void {
  for (const [key, record] of records) {
    if (records.size <= maxKeys) {
      return
    }

    pruneTimestamps(record, now, interval)

    if (record.size === 0 && activeCount(record) === 0) {
      clearRecordTimer(record)
      records.delete(key)
    }
  }
}

function appendQueue(record: RateLimitRecord, entry: QueueEntry): void {
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

function shiftQueue(record: RateLimitRecord): QueueEntry | undefined {
  const entry = record.head

  if (entry) {
    removeQueuedEntry(record, entry)
  }

  return entry
}

function removeQueuedEntry(record: RateLimitRecord, entry: QueueEntry): void {
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

  if (record.size === 0) {
    clearRecordTimer(record)
  }
}

function clearRecordTimer(record: RateLimitRecord): void {
  if (record.timer !== undefined) {
    clearTimeout(record.timer)
    record.timer = undefined
  }
}

function normalizeOptions(options: RateLimitPluginOptions): NormalizedOptions {
  return {
    maxRequests: normalizePositiveInteger(options.maxRequests, 10),
    interval: normalizePositiveDuration(options.interval, 1000),
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

function normalizePositiveDuration(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(Math.max(1, value), MAX_TIMER_DELAY)
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
    code: 'RATE_LIMIT',
    config
  })
}

function createAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  return new RequestError(
    'Request aborted while waiting for rate limit permit',
    {
      code: 'ABORT_ERROR',
      config,
      cause: reason
    }
  )
}

function createRemovedError(config: RequestConfig): RequestError {
  return new RequestError(
    'Rate limit plugin removed while request was queued',
    {
      code: 'ABORT_ERROR',
      config
    }
  )
}
