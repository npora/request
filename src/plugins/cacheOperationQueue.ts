import { isPromiseLike } from '../utils/isPromiseLike'
import type { MaybePromise } from './cacheStores'

/** Order store mutations without adding promises to synchronous stores. */
export class CacheOperationQueue {
  readonly pending = new Map<string, Promise<void>>()
  clearing?: Promise<void>

  run<T>(key: string, operation: () => MaybePromise<T>, waits: Iterable<Promise<void>> = []): MaybePromise<T> {
    const pending = new Set(waits)
    const previous = this.pending.get(key)
    if (previous) pending.add(previous)
    if (this.clearing) pending.add(this.clearing)
    const result = pending.size ? Promise.all(pending).then(operation) : operation()
    if (!isPromiseLike(result)) return result
    const completed = Promise.resolve(result).then(() => {}, () => {}).finally(() => {
      if (this.pending.get(key) === completed) this.pending.delete(key)
    })
    this.pending.set(key, completed)
    return Promise.resolve(result)
  }

  clear<T>(operation: () => MaybePromise<T>, waits: Iterable<Promise<void>> = []): MaybePromise<T> {
    const pending = new Set([...this.pending.values(), ...waits])
    if (this.clearing) pending.add(this.clearing)
    const result = pending.size ? Promise.all(pending).then(operation) : operation()
    if (!isPromiseLike(result)) return result
    const completed = Promise.resolve(result).then(() => {}, () => {}).finally(() => {
      if (this.clearing === completed) this.clearing = undefined
    })
    this.clearing = completed
    return Promise.resolve(result)
  }
}

export interface CacheOperationToken {
  key: string
  tags: readonly string[]
  valid: boolean
}

/** Track only in-flight work so per-key invalidation metadata stays bounded. */
export class CacheInvalidation {
  private readonly pending = new Set<CacheOperationToken>()

  capture(key: string, tags: readonly string[] = []): CacheOperationToken {
    const token = { key, tags: [...tags], valid: true }
    this.pending.add(token)
    return token
  }

  release(token: CacheOperationToken): void { this.pending.delete(token) }

  invalidate(key?: string): void {
    for (const token of this.pending) {
      if (key === undefined || token.key === key) token.valid = false
    }
  }

  invalidateTags(tags: readonly string[]): void {
    for (const token of this.pending) {
      if (token.tags.some(tag => tags.includes(tag))) token.valid = false
    }
  }
}
