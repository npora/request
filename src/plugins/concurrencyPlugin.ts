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
  queue: QueueEntry[]
}

interface QueueEntry {
  context: object
  config: RequestConfig
  resolve(): void
  reject(error: unknown): void
  cleanup(): void
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
        queued: record?.queue.length ?? 0
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

        if (record.queue.length >= normalized.maxQueue) {
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
          record.queue.length === 0
        ) {
          touchRecord(records, record.key, record)
          trimRecords(records, normalized.maxKeys)
        }
      })

      return () => {
        active = false

        for (const record of records.values()) {
          for (const entry of record.queue.splice(0)) {
            entry.cleanup()
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

    const remove = () => {
      const index = record.queue.indexOf(entry)

      if (index !== -1) {
        record.queue.splice(index, 1)
      }
    }
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }

      signal?.removeEventListener('abort', onAbort)
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
      resolve: resolveOnce,
      reject: rejectOnce,
      cleanup
    }

    record.queue.push(entry)
    signal?.addEventListener('abort', onAbort, {
      once: true
    })

    if (Number.isFinite(timeout)) {
      timer = setTimeout(() => {
        remove()
        rejectOnce(
          createLimitError('Concurrency queue wait timed out', config)
        )
      }, timeout)
    }
  })
}

function releaseNext(
  record: ConcurrencyRecord,
  grant: (entry: QueueEntry) => void
): void {
  const next = record.queue.shift()

  if (next) {
    next.cleanup()
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
    queue: []
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

    if (record.active === 0 && record.queue.length === 0) {
      records.delete(key)
    }
  }
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
