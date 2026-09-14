import { isRequestError, RequestError } from '../errors'
import type { RequestConfig } from '../types'
import { isPromiseLike } from '../utils/isPromiseLike'
import type { CacheEntry, CacheStore, MaybePromise } from './cacheStores'

export interface KeyGeneration {
  activeRequests: number
  tags: Set<string>
}

export interface CacheGeneration {
  global: number
  key: string
  token: KeyGeneration
}

export function acquireCacheGeneration(
  global: number,
  key: string,
  generations: Map<string, KeyGeneration>,
  tags: readonly string[]
): CacheGeneration {
  let token = generations.get(key)

  if (!token) {
    token = {
      activeRequests: 0,
      tags: new Set()
    }
    generations.set(key, token)
  }

  token.activeRequests += 1

  for (const tag of tags) {
    token.tags.add(tag)
  }

  return { global, key, token }
}

export function isCurrentCacheGeneration(
  generation: CacheGeneration | undefined,
  global: number,
  generations: Map<string, KeyGeneration>
): boolean {
  return generation !== undefined &&
    generation.global === global &&
    generations.get(generation.key) === generation.token
}

export function releaseCacheGeneration(
  generation: CacheGeneration,
  generations: Map<string, KeyGeneration>
): void {
  generation.token.activeRequests -= 1

  if (
    generation.token.activeRequests === 0 &&
    generations.get(generation.key) === generation.token
  ) {
    generations.delete(generation.key)
  }
}

export interface InFlightRequest {
  owner: {
    readonly preserveRaw: boolean
  }

  key: string

  generation: CacheGeneration

  rawDemanded?: true

  promise?: Promise<CacheEntry | undefined>

  resolve?: (entry: CacheEntry | undefined) => void

  reject?: (error: unknown) => void
}

export function createInFlightRequest(
  owner: InFlightRequest['owner'],
  key: string,
  generation: CacheGeneration
): InFlightRequest {
  return {
    owner,
    key,
    generation
  }
}

export function getInFlightPromise(
  request: InFlightRequest
): Promise<CacheEntry | undefined> {
  if (request.promise) {
    return request.promise
  }

  let resolve!: (entry: CacheEntry | undefined) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<CacheEntry | undefined>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    }
  )

  void promise.catch(() => {})

  request.promise = promise
  request.resolve = resolve
  request.reject = reject

  return promise
}

export function readStore(
  store: CacheStore,
  key: string
): MaybePromise<CacheEntry | undefined> {
  try {
    const result = store.get(key)

    return isPromiseLike(result)
      ? Promise.resolve(result).catch(() => undefined)
      : result
  } catch {
    return undefined
  }
}

export function writeStore(
  store: CacheStore,
  key: string,
  entry: CacheEntry
): MaybePromise<void> {
  try {
    const result = store.set(key, entry)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).catch(ignoreStoreError)
    }
  } catch {
    // Cache storage failures must not change the network response.
  }
}

export function deleteStore(
  store: CacheStore,
  key: string
): MaybePromise<void> {
  try {
    const result = store.delete(key)

    if (isPromiseLike(result)) {
      return Promise.resolve(result).catch(ignoreStoreError)
    }
  } catch {
    // Expired or disabled cache entries can be ignored safely.
  }
}

function ignoreStoreError(): void {
  // Cache storage failures must not change the request lifecycle.
}

export function waitForSharedRecord(
  promise: Promise<CacheEntry | undefined>,
  config: RequestConfig
): Promise<CacheEntry | undefined> {
  const signal = config.signal

  if (!signal) {
    return promise.catch(error => {
      throw cloneSharedError(error, config)
    })
  }

  if (signal.aborted) {
    return Promise.reject(
      createSharedAbortError(signal.reason, config)
    )
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup failures must not retain a shared-response wait.
      }
    }
    const resolveOnce = (entry: CacheEntry | undefined) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(entry)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      rejectOnce(createSharedAbortError(signal.reason, config))
    }

    try {
      signal.addEventListener('abort', onAbort, {
        once: true
      })
    } catch (error) {
      rejectOnce(error)
      return
    }

    if (signal.aborted) {
      onAbort()
    }

    if (settled) {
      return
    }

    promise.then(
      resolveOnce,
      error => {
        rejectOnce(cloneSharedError(error, config))
      }
    )
  })
}

function createSharedAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  return new RequestError('Request aborted while waiting for shared response', {
    code: 'ABORT_ERROR',
    config,
    cause: reason
  })
}

function cloneSharedError(
  error: unknown,
  config: RequestConfig
): unknown {
  if (!isRequestError(error)) {
    return error
  }

  return new RequestError(error.message, {
    code: error.code,
    status: error.status,
    data: error.data,
    response: error.response,
    config,
    cause: error
  })
}
