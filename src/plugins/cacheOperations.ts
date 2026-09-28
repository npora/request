import { isPromiseLike } from '../utils/isPromiseLike'
import type { CacheEventType } from './cacheTypes'
import type { MaybePromise } from './cacheStores'
import type { CacheState } from './cacheState'

/** Serializes explicit writes and invalidations while preserving sync stores. */
export function createCacheOperations(state: CacheState) {
  const {
    keyOperations,
    tagInvalidations,
    recordEvent,
    keyGenerations,
    inFlight,
    rawInFlight,
    backgroundRefreshes
  } = state

  function trackKeyOperation<T>(
    key: string,
    result: PromiseLike<T>,
    success?: CacheEventType,
    failure?: CacheEventType
  ): Promise<T> {
    const operation = Promise.resolve(result)
    let pending!: Promise<void>

    pending = operation.then(
      () => success && recordEvent(success),
      () => failure && recordEvent(failure)
    ).finally(() => {
      if (keyOperations.get(key) === pending) {
        keyOperations.delete(key)
      }
    })

    keyOperations.set(key, pending)
    return operation
  }

  function runKeyOperation<T>(
    key: string,
    operation: () => MaybePromise<T>,
    waits: Iterable<Promise<void>> = [],
    success?: CacheEventType,
    failure?: CacheEventType
  ): MaybePromise<T> {
    const pending = new Set(waits)
    const previous = keyOperations.get(key)

    if (previous) {
      pending.add(previous)
    }

    if (pending.size > 0) {
      return trackKeyOperation(
        key,
        Promise.all(pending).then(operation),
        success,
        failure
      )
    }

    let result: MaybePromise<T>

    try {
      result = operation()
    } catch (error) {
      if (failure) {
        recordEvent(failure)
      }

      throw error
    }

    if (isPromiseLike(result)) {
      return trackKeyOperation(key, result, success, failure)
    }

    if (success) {
      recordEvent(success)
    }

    return result
  }

  function invalidateKeyState(key: string, reason: string): void {
    keyGenerations.delete(key)
    inFlight.delete(key)
    rawInFlight.delete(key)

    const refresh = backgroundRefreshes.get(key)

    if (refresh) {
      backgroundRefreshes.delete(key)
      refresh.abort(reason)
    }
  }

  function trackTagInvalidation(
    tags: readonly string[],
    invalidation: PromiseLike<number>
  ): Promise<number> {
    const operation = Promise.resolve(invalidation)
    let pending!: Promise<void>

    pending = operation.then(
      () => recordEvent('invalidated'),
      () => recordEvent('invalidation-error')
    ).finally(() => {
      for (const tag of tags) {
        if (tagInvalidations.get(tag) === pending) {
          tagInvalidations.delete(tag)
        }
      }
    })

    for (const tag of tags) {
      tagInvalidations.set(tag, pending)
    }

    return operation
  }

  return { runKeyOperation, invalidateKeyState, trackTagInvalidation }
}
