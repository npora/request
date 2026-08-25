import { RequestError } from '../errors'
import { isPromiseLike } from '../utils/isPromiseLike'
import type {
  CacheEntry,
  CacheRefreshLease,
  CacheStore
} from './cachePlugin'

type MaybePromise<T> = T | Promise<T>

export interface TieredCacheStoreOptions {
  /** Fast first-level store, usually MemoryCacheStore. */
  primary: CacheStore

  /** Durable or shared second-level store. */
  secondary: CacheStore

  /** Optional cross-context invalidation for the primary tier. */
  broadcast?: TieredCacheBroadcastOptions

  /** Optional cross-context refresh coalescing through Web Locks. */
  coordination?: TieredCacheCoordinationOptions
}

export interface TieredCacheBroadcastOptions {
  /** Application-scoped channel supplied by the caller. */
  channel: BroadcastChannel

  /** Maximum cache keys tracked for targeted invalidation. @default 1000 */
  maxTrackedKeys?: number
}

export interface TieredCacheCoordinationOptions {
  /** Web Locks manager, usually navigator.locks. */
  locks: LockManager

  /** Application-scoped lock namespace. @default npora-cache */
  namespace?: string
}

/** A read-through, write-through cache composed from two stores. */
export class TieredCacheStore implements CacheStore {
  readonly acquireRefreshLease?: (
    key: string,
    signal?: AbortSignal
  ) => Promise<CacheRefreshLease>

  private readonly primary: CacheStore

  private readonly secondary: CacheStore

  private readonly channel?: BroadcastChannel

  private readonly locks?: LockManager

  private readonly lockNamespace: string

  private readonly leaseReleases = new Set<() => void>()

  private readonly source = `${Date.now()}:${Math.random()}`

  private readonly trackedKeys = new Map<string, Set<string>>()

  private readonly maxTrackedKeys: number

  private trackedKeyCount = 0

  constructor(options: TieredCacheStoreOptions) {
    if (
      !options ||
      !options.primary ||
      !options.secondary ||
      options.primary === options.secondary
    ) {
      throw new RequestError(
        'Tiered cache requires distinct primary and secondary stores',
        { code: 'CONFIG_ERROR' }
      )
    }

    this.primary = options.primary
    this.secondary = options.secondary

    if (options.broadcast && !options.broadcast.channel) {
      throw new RequestError(
        'Tiered cache broadcast requires a channel',
        { code: 'CONFIG_ERROR' }
      )
    }

    if (
      options.coordination &&
      !options.coordination.locks
    ) {
      throw new RequestError(
        'Tiered cache coordination requires a lock manager',
        { code: 'CONFIG_ERROR' }
      )
    }

    this.channel = options.broadcast?.channel
    this.locks = options.coordination?.locks
    this.lockNamespace = normalizeLockNamespace(
      options.coordination?.namespace
    )
    this.maxTrackedKeys = normalizeTrackedKeys(
      options.broadcast?.maxTrackedKeys
    )

    if (this.locks) {
      this.acquireRefreshLease = (key, signal) => {
        return this.acquireCoordinatedLease(key, signal)
      }
    }

    this.channel?.addEventListener('message', this.handleMessage)
  }

  get(key: string): MaybePromise<CacheEntry | undefined> {
    let primary: MaybePromise<CacheEntry | undefined>

    try {
      primary = this.primary.get(key)
    } catch {
      return this.readSecondary(key)
    }

    if (isPromiseLike(primary)) {
      return Promise.resolve(primary).then(
        entry => entry
          ? this.remember(key, entry)
          : this.readSecondary(key),
        () => this.readSecondary(key)
      )
    }

    return primary
      ? this.remember(key, primary)
      : this.readSecondary(key)
  }

  set(key: string, entry: CacheEntry): MaybePromise<void> {
    const writePrimary = () => {
      let result: MaybePromise<void>

      try {
        result = this.primary.set(key, entry)
      } catch (error) {
        this.recoverPrimaryWrite(key)
        throw error
      }

      return isPromiseLike(result)
        ? Promise.resolve(result).catch(error => {
            this.recoverPrimaryWrite(key)
            throw error
          })
        : result
    }
    const secondary = this.secondary.set(key, entry)

    const result = isPromiseLike(secondary)
      ? Promise.resolve(secondary).then(writePrimary)
      : writePrimary()

    return this.afterSuccess(result, () => {
      this.trackKey(key)
      this.broadcastKey(key)
    })
  }

  delete(key: string): MaybePromise<void> {
    return this.afterSettled(
      () => combineStoreOperations([
        () => this.primary.delete(key),
        () => this.secondary.delete(key)
      ], () => undefined),
      () => {
        this.untrackKey(key)
        this.broadcastKey(key)
      }
    )
  }

  invalidateTags(tags: readonly string[]): MaybePromise<number> {
    const primary = this.primary.invalidateTags
    const secondary = this.secondary.invalidateTags

    if (!primary || !secondary) {
      throw new RequestError(
        'Both tiered cache stores must support tag invalidation',
        { code: 'CONFIG_ERROR' }
      )
    }

    return this.afterSettled(
      () => combineStoreOperations([
        () => primary.call(this.primary, tags),
        () => secondary.call(this.secondary, tags)
      ], results => Math.max(...results)),
      () => this.broadcastClear()
    )
  }

  clear(): MaybePromise<void> {
    return this.afterSettled(
      () => combineStoreOperations([
        () => this.primary.clear(),
        () => this.secondary.clear()
      ], () => undefined),
      () => this.broadcastClear()
    )
  }

  private async acquireCoordinatedLease(
    key: string,
    signal?: AbortSignal
  ): Promise<CacheRefreshLease> {
    const name = `${this.lockNamespace}:${fingerprintCacheKey(key)}`
    const immediate = await this.requestLease(name, true, signal)

    if (immediate) {
      return immediate
    }

    const waited = await this.requestLease(name, false, signal)

    if (!waited) {
      throw new RequestError('Cache refresh lock was unavailable', {
        code: 'NETWORK_ERROR'
      })
    }

    await ignoreStoreFailure(() => this.primary.delete(key))

    return waited
  }

  /** Stop listening for cross-context invalidation messages. */
  dispose(): void {
    this.channel?.removeEventListener('message', this.handleMessage)

    for (const release of this.leaseReleases) {
      release()
    }

    this.leaseReleases.clear()
    this.trackedKeys.clear()
    this.trackedKeyCount = 0
  }

  private requestLease(
    name: string,
    ifAvailable: boolean,
    signal?: AbortSignal
  ): Promise<CacheRefreshLease | undefined> {
    return new Promise((resolve, reject) => {
      let settled = false
      const released = createDeferred()
      const options: LockOptions = {
        mode: 'exclusive',
        ifAvailable
      }

      if (signal) {
        options.signal = signal
      }

      const request = this.locks!.request(
        name,
        options,
        async lock => {
          if (!lock) {
            settled = true
            resolve(undefined)
            return
          }

          let active = true
          const release = () => {
            if (!active) {
              return
            }

            active = false
            this.leaseReleases.delete(release)
            released.resolve()
          }

          this.leaseReleases.add(release)
          settled = true
          resolve({
            contended: !ifAvailable,
            release
          })
          await released.promise
        }
      )

      void request.catch(error => {
        if (!settled) {
          reject(error)
        }
      })
    })
  }

  private readSecondary(
    key: string
  ): MaybePromise<CacheEntry | undefined> {
    const promote = (
      entry: CacheEntry | undefined
    ): MaybePromise<CacheEntry | undefined> => {
      if (!entry) {
        return undefined
      }

      try {
        const result = this.primary.set(key, entry)

        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            () => this.remember(key, entry),
            () => this.remember(key, entry)
          )
        }
      } catch {
        // Promotion failure does not discard a valid secondary hit.
      }

      return this.remember(key, entry)
    }
    const secondary = this.secondary.get(key)

    return isPromiseLike(secondary)
      ? Promise.resolve(secondary).then(promote)
      : promote(secondary)
  }

  private remember(
    key: string,
    entry: CacheEntry
  ): CacheEntry {
    this.trackKey(key)
    return entry
  }

  private trackKey(key: string): void {
    if (!this.channel) {
      return
    }

    const fingerprint = fingerprintCacheKey(key)
    let keys = this.trackedKeys.get(fingerprint)

    if (keys?.has(key)) {
      this.trackedKeys.delete(fingerprint)
      this.trackedKeys.set(fingerprint, keys)
      return
    }

    while (this.trackedKeyCount >= this.maxTrackedKeys) {
      const oldest = this.trackedKeys.entries().next().value as
        | [string, Set<string>]
        | undefined

      if (!oldest) {
        break
      }

      this.trackedKeys.delete(oldest[0])
      this.trackedKeyCount -= oldest[1].size
    }

    keys ??= new Set()
    keys.add(key)
    this.trackedKeys.delete(fingerprint)
    this.trackedKeys.set(fingerprint, keys)
    this.trackedKeyCount += 1
  }

  private untrackKey(key: string): void {
    const fingerprint = fingerprintCacheKey(key)
    const keys = this.trackedKeys.get(fingerprint)

    if (!keys?.delete(key)) {
      return
    }

    this.trackedKeyCount -= 1

    if (keys.size === 0) {
      this.trackedKeys.delete(fingerprint)
    }
  }

  private broadcastKey(key: string): void {
    this.postMessage({
      protocol: 'npora-cache:1',
      source: this.source,
      action: 'delete',
      fingerprint: fingerprintCacheKey(key)
    })
  }

  private broadcastClear(): void {
    this.trackedKeys.clear()
    this.trackedKeyCount = 0
    this.postMessage({
      protocol: 'npora-cache:1',
      source: this.source,
      action: 'clear'
    })
  }

  private postMessage(message: TieredCacheMessage): void {
    try {
      this.channel?.postMessage(message)
    } catch {
      // Cross-context invalidation is best effort.
    }
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    const message = event.data

    if (
      !isTieredCacheMessage(message) ||
      message.source === this.source
    ) {
      return
    }

    if (message.action === 'clear') {
      this.clearPrimary()
      return
    }

    const keys = this.trackedKeys.get(message.fingerprint)

    if (!keys) {
      this.clearPrimary()
      return
    }

    this.trackedKeys.delete(message.fingerprint)
    this.trackedKeyCount -= keys.size

    for (const key of keys) {
      ignoreStoreResult(() => this.primary.delete(key))
    }
  }

  private clearPrimary(): void {
    this.trackedKeys.clear()
    this.trackedKeyCount = 0
    ignoreStoreResult(() => this.primary.clear())
  }

  private recoverPrimaryWrite(key: string): void {
    this.untrackKey(key)
    ignoreStoreResult(() => this.primary.delete(key))
    this.broadcastKey(key)
  }

  private afterSuccess<T>(
    result: MaybePromise<T>,
    success: () => void
  ): MaybePromise<T> {
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(value => {
        success()
        return value
      })
    }

    success()
    return result
  }

  private afterSettled<T>(
    operation: () => MaybePromise<T>,
    settled: () => void
  ): MaybePromise<T> {
    let result: MaybePromise<T>

    try {
      result = operation()
    } catch (error) {
      settled()
      throw error
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        value => {
          settled()
          return value
        },
        error => {
          settled()
          throw error
        }
      )
    }

    settled()
    return result
  }
}

interface TieredCacheDeleteMessage {
  protocol: 'npora-cache:1'
  source: string
  action: 'delete'
  fingerprint: string
}

interface TieredCacheClearMessage {
  protocol: 'npora-cache:1'
  source: string
  action: 'clear'
}

type TieredCacheMessage =
  | TieredCacheDeleteMessage
  | TieredCacheClearMessage

function combineStoreOperations<T>(
  operations: ReadonlyArray<() => MaybePromise<T>>,
  combine: (results: T[]) => T
): MaybePromise<T> {
  const results: T[] = []
  const pending: Promise<void>[] = []
  let firstError: unknown
  let failed = false

  for (const operation of operations) {
    try {
      const result = operation()

      if (isPromiseLike(result)) {
        pending.push(Promise.resolve(result).then(
          value => {
            results.push(value)
          },
          error => {
            if (!failed) {
              failed = true
              firstError = error
            }
          }
        ))
      } else {
        results.push(result)
      }
    } catch (error) {
      if (!failed) {
        failed = true
        firstError = error
      }
    }
  }

  const finish = () => {
    if (failed) {
      throw firstError
    }

    return combine(results)
  }

  return pending.length > 0
    ? Promise.all(pending).then(finish)
    : finish()
}

function fingerprintCacheKey(key: string): string {
  let hash = 2166136261

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function isTieredCacheMessage(value: unknown): value is TieredCacheMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as {
    protocol?: unknown
    source?: unknown
    action?: unknown
    fingerprint?: unknown
  }

  return message.protocol === 'npora-cache:1' &&
    typeof message.source === 'string' &&
    (
      message.action === 'clear' ||
      (
        message.action === 'delete' &&
        typeof message.fingerprint === 'string' &&
        message.fingerprint.length <= 16
      )
    )
}

function normalizeTrackedKeys(value?: number): number {
  const maximum = value ?? 1000

  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100000) {
    throw new RequestError(
      'Tiered cache maxTrackedKeys must be an integer from 1 to 100000',
      { code: 'CONFIG_ERROR' }
    )
  }

  return maximum
}

function normalizeLockNamespace(value?: string): string {
  const namespace = value ?? 'npora-cache'

  if (
    typeof namespace !== 'string' ||
    namespace.length < 1 ||
    namespace.length > 128
  ) {
    throw new RequestError(
      'Tiered cache lock namespace must contain 1 to 128 characters',
      { code: 'CONFIG_ERROR' }
    )
  }

  return namespace
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function ignoreStoreResult(operation: () => MaybePromise<unknown>): void {
  try {
    const result = operation()

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => {})
    }
  } catch {
    // Remote invalidation failures cannot affect the sender.
  }
}

async function ignoreStoreFailure(
  operation: () => MaybePromise<unknown>
): Promise<void> {
  try {
    await operation()
  } catch {
    // Lease coordination still proceeds when primary eviction fails.
  }
}
