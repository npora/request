import type {
  CacheOptions,
  HttpMethod,
  NporaResponse,
  QueryParams,
  RequestConfig
} from '../types'
import { RequestError } from '../errors'
import { isURLSearchParams } from '../utils/isURLSearchParams'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

type MaybePromise<T> = T | Promise<T>

export interface CacheEntry {
  data: unknown

  expiresAt: number

  status: number

  statusText: string

  headers: Array<[string, string]>

  raw?: Response
}

export interface CacheStore {
  get(key: string): MaybePromise<CacheEntry | undefined>

  set(key: string, entry: CacheEntry): MaybePromise<void>

  delete(key: string): MaybePromise<void>

  clear(): MaybePromise<void>
}

export interface MemoryCacheStoreOptions {
  /**
   * Maximum entries retained by the in-memory LRU store.
   * Use `Infinity` for no practical limit.
   *
   * @default 1000
   */
  maxEntries?: number
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>()

  private readonly maxEntries: number

  private newestKey: string | undefined

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxEntries = normalizeMaxEntries(options.maxEntries)
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key)

    if (!entry) {
      return undefined
    }

    if (isExpired(entry.expiresAt)) {
      this.entries.delete(key)

      if (this.newestKey === key) {
        this.newestKey = undefined
      }

      return undefined
    }

    if (this.newestKey !== key) {
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.newestKey = key
    }

    return entry
  }

  set(key: string, entry: CacheEntry): void {
    if (this.maxEntries === 0) {
      return
    }

    this.entries.delete(key)

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value

      if (oldestKey === undefined) {
        break
      }

      this.entries.delete(oldestKey)
    }

    this.entries.set(key, entry)
    this.newestKey = key
  }

  delete(key: string): void {
    this.entries.delete(key)

    if (this.newestKey === key) {
      this.newestKey = undefined
    }
  }

  clear(): void {
    this.entries.clear()
    this.newestKey = undefined
  }
}

export interface CachePluginOptions {
  /**
   * HTTP methods that may be cached.
   *
   * @default GET and HEAD
   */
  methods?: readonly HttpMethod[]

  /**
   * Additional request headers included in the default cache key.
   * All explicitly configured request headers are included automatically.
   *
   * @default authorization, cookie, accept and accept-language
   */
  varyHeaders?: readonly string[]

  /**
   * Cache storage shared by this plugin instance.
   *
   * @default an isolated MemoryCacheStore
   */
  store?: CacheStore

  /**
   * Maximum entries retained by the default MemoryCacheStore.
   * Ignored when `store` is provided.
   *
   * @default 1000
   */
  maxEntries?: number

  /**
   * Share one network operation between concurrent equivalent requests.
   *
   * @default true
   */
  dedupe?: boolean
}

export interface CachePlugin extends Plugin {
  clear(): MaybePromise<void>
}

const DEFAULT_CACHE_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD'
]

const DEFAULT_VARY_HEADERS = [
  'authorization',
  'cookie',
  'accept',
  'accept-language'
] as const

const EMPTY_QUERY: ReadonlyArray<[string, string]> = []

export function cachePlugin(
  options: CachePluginOptions = {}
): CachePlugin {
  const store = options.store ?? new MemoryCacheStore({
    maxEntries: options.maxEntries
  })
  const cacheHits = new WeakSet<object>()
  const leaders = new WeakMap<object, InFlightRequest>()
  const unsharedGenerations = new WeakMap<object, number>()
  const completedRecords = new WeakMap<object, CacheEntry>()
  const uncacheableLeaders = new WeakSet<object>()
  const inFlight = new Map<string, InFlightRequest>()
  const rawInFlight = new Map<string, InFlightRequest>()
  const rawLeaders = new WeakSet<object>()
  let generation = 0
  const methods = new Set(
    options.methods ?? DEFAULT_CACHE_METHODS
  )
  const varyHeaders = normalizeVaryHeaders(
    options.varyHeaders ?? DEFAULT_VARY_HEADERS
  )
  const emptyHeaderValues = normalizeCacheHeaders(
    undefined,
    varyHeaders
  )
  const keyMemo: CacheKeyMemo = {}

  const plugin: CachePlugin = {
    name: 'cache',

    clear() {
      generation += 1
      inFlight.clear()
      rawInFlight.clear()
      return store.clear()
    },

    install(context) {
      const ownedLeaders = new Set<object>()
      let active = true

      context.hooks.onRequest(requestContext => {
        const cache = resolveExtensionConfig(
          requestContext.config,
          'cache'
        )

        if (
          !cache?.enabled ||
          !isCacheableRequest(requestContext.config, methods)
        ) {
          return
        }

        normalizeCacheTtl(cache.ttl, requestContext.config)
        const requestGeneration = generation

        const key = createCacheKey(
          requestContext.config,
          cache,
          varyHeaders,
          emptyHeaderValues,
          keyMemo
        )
        const stored = readStore(store, key)

        if (
          requestContext.config.signal &&
          isPromiseLike(stored)
        ) {
          return waitForSignal(() => stored, requestContext.config)
            .then(record => {
            if (requestGeneration !== generation) {
              return
            }

            return handleCacheRecord(
              requestContext,
              cache,
              key,
              record,
              requestGeneration
            )
          })
        }

        if (isPromiseLike(stored)) {
          return Promise.resolve(stored).then(record => {
            if (requestGeneration !== generation) {
              return
            }

            return handleCacheRecord(
              requestContext,
              cache,
              key,
              record,
              requestGeneration
            )
          })
        }

        return handleCacheRecord(
          requestContext,
          cache,
          key,
          stored,
          requestGeneration
        )
      })

      context.hooks.onResponse(requestContext => {
        if (cacheHits.has(requestContext)) {
          return
        }

        const cache = resolveExtensionConfig(
          requestContext.config,
          'cache'
        )

        if (
          !cache?.enabled ||
          !requestContext.response ||
          !isCacheableRequest(requestContext.config, methods)
        ) {
          return
        }

        const leader = leaders.get(requestContext)
        const key = leader?.key ?? createCacheKey(
          requestContext.config,
          cache,
          varyHeaders,
          emptyHeaderValues,
          keyMemo
        )
        const currentGeneration =
          (
            leader?.generation ??
            unsharedGenerations.get(requestContext)
          ) === generation

        if (isAsyncIterable(requestContext.response.data)) {
          uncacheableLeaders.add(requestContext)

          if (!currentGeneration) {
            return
          }

          const deletion = deleteStore(store, key)

          if (isPromiseLike(deletion)) {
            return requestContext.config.signal
              ? waitForSignal(() => deletion, requestContext.config)
              : deletion
          }
          return
        }

        const ttl = normalizeCacheTtl(
          cache.ttl,
          requestContext.config
        )

        if (
          ttl <= 0 ||
          !allowsPersistentCaching(requestContext.response)
        ) {
          const deletion = currentGeneration
            ? deleteStore(store, key)
            : undefined
          const waitsForDeletion = isPromiseLike(deletion)
          const pending = leader

          if (
            pending?.owner === requestContext &&
            (pending.promise !== undefined || waitsForDeletion)
          ) {
            completedRecords.set(
              requestContext,
              createCacheEntry(
                requestContext.response,
                Date.now() + Math.max(0, ttl),
                requestContext.preserveRaw
              )
            )
          } else if (pending?.owner === requestContext) {
            uncacheableLeaders.add(requestContext)
          }

          if (waitsForDeletion) {
            return requestContext.config.signal
              ? waitForSignal(
                  () => deletion as PromiseLike<void>,
                  requestContext.config
                )
              : deletion
          }
          return
        }

        const record = createCacheEntry(
          requestContext.response,
          Date.now() + ttl,
          requestContext.preserveRaw
        )

        completedRecords.set(requestContext, record)

        if (!currentGeneration) {
          return
        }

        if (leader?.rawDemanded) {
          return
        }

        const write = writeStore(store, key, record)

        if (isPromiseLike(write)) {
          return requestContext.config.signal
            ? waitForSignal(() => write, requestContext.config)
            : write
        }
      }, { requiresRawResponse: false })

      function handleCacheRecord(
        requestContext: {
          config: RequestConfig
          response?: NporaResponse
          readonly preserveRaw: boolean
        },
        cache: CacheOptions,
        key: string,
        record: CacheEntry | undefined,
        requestGeneration: number
      ): void | Promise<void> {
        if (!active) {
          return
        }

        if (record) {
          if (!isExpired(record.expiresAt)) {
            if (requestContext.preserveRaw && !record.raw) {
              return prepareCacheMiss(
                requestContext,
                cache,
                key,
                requestGeneration
              )
            }

            const cachedResponse = restoreCacheEntry(
              record,
              requestContext.config
            )

            if (cachedResponse) {
              requestContext.response = cachedResponse
              cacheHits.add(requestContext)
              return
            }

          }

          const deletion = deleteStore(store, key)

          if (isPromiseLike(deletion)) {
            const deleted = requestContext.config.signal
              ? waitForSignal(() => deletion, requestContext.config)
              : Promise.resolve(deletion)

            return deleted.then(() => {
              return prepareCacheMiss(
                requestContext,
                cache,
                key,
                requestGeneration
              )
            })
          }
        }

        return prepareCacheMiss(
          requestContext,
          cache,
          key,
          requestGeneration
        )
      }

      function prepareCacheMiss(
        requestContext: {
          config: RequestConfig
          response?: NporaResponse
          readonly preserveRaw: boolean
        },
        cache: CacheOptions,
        key: string,
        requestGeneration: number
      ): void | Promise<void> {
        if (!active || requestGeneration !== generation) {
          return
        }

        if (!(cache.dedupe ?? options.dedupe ?? true)) {
          unsharedGenerations.set(requestContext, requestGeneration)
          return
        }

        const pending = requestContext.preserveRaw
          ? rawInFlight.get(key)
          : inFlight.get(key) ?? rawInFlight.get(key)

        if (pending) {
          return waitForSharedRecord(
            getInFlightPromise(pending),
            requestContext.config
          ).then(sharedRecord => {
            if (!sharedRecord) {
              return
            }

            requestContext.response = createCachedResponse(
              sharedRecord,
              requestContext.config
            )
            cacheHits.add(requestContext)
          })
        }

        if (requestContext.preserveRaw) {
          const dataPending = inFlight.get(key)

          if (dataPending) {
            dataPending.rawDemanded = true
          }
        }

        const created = createInFlightRequest(
          requestContext,
          key,
          requestGeneration
        )

        if (requestContext.preserveRaw) {
          rawInFlight.set(key, created)
          rawLeaders.add(requestContext)
        } else {
          inFlight.set(key, created)
        }
        leaders.set(requestContext, created)
        ownedLeaders.add(requestContext)
      }

      context.hooks.onSettled(requestContext => {
        const pending = leaders.get(requestContext)

        if (!pending) {
          return
        }

        leaders.delete(requestContext)
        ownedLeaders.delete(requestContext)

        const key = pending.key

        const requests = rawLeaders.delete(requestContext)
          ? rawInFlight
          : inFlight

        if (requests.get(key) === pending) {
          requests.delete(key)
        }

        if (uncacheableLeaders.delete(requestContext)) {
          pending.resolve?.(undefined)
          return
        }

        const record = completedRecords.get(requestContext)

        completedRecords.delete(requestContext)

        if (
          record &&
          requestContext.response &&
          (
            !requestContext.error ||
            isSchemaValidationFailure(requestContext.error)
          )
        ) {
          pending.resolve?.(record)
          return
        }

        pending.reject?.(
          requestContext.error ??
          new RequestError('Shared request failed', {
            code: 'NETWORK_ERROR',
            config: requestContext.config
          })
        )
      })

      return () => {
        active = false

        for (const owner of ownedLeaders) {
          const pending = leaders.get(owner)

          leaders.delete(owner)

          if (!pending) {
            continue
          }

          const key = pending.key

          const requests = rawLeaders.delete(owner)
            ? rawInFlight
            : inFlight

          if (requests.get(key) === pending) {
            requests.delete(key)
          }
          pending.reject?.(
            new RequestError('Cache plugin removed during shared request', {
              code: 'ABORT_ERROR'
            })
          )
        }

        ownedLeaders.clear()
      }
    }
  }

  return plugin
}

interface InFlightRequest {
  owner: {
    readonly preserveRaw: boolean
  }

  key: string

  generation: number

  rawDemanded?: true

  promise?: Promise<CacheEntry | undefined>

  resolve?: (entry: CacheEntry | undefined) => void

  reject?: (error: unknown) => void
}

function createInFlightRequest(
  owner: InFlightRequest['owner'],
  key: string,
  generation: number
): InFlightRequest {
  return {
    owner,
    key,
    generation
  }
}

function getInFlightPromise(
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

function readStore(
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

function writeStore(
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

function deleteStore(
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

function waitForSharedRecord(
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
  if (!(error instanceof RequestError)) {
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

function createCacheEntry(
  response: NporaResponse,
  expiresAt: number,
  preserveRaw: boolean
): CacheEntry {
  return {
    data: cloneCacheValue(response.data),
    expiresAt,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    raw: preserveRaw
      ? cloneResponse(response.raw)
      : undefined
  }
}

function createCachedResponse(
  record: CacheEntry,
  config: RequestConfig
): NporaResponse {
  return {
    data: cloneCacheValue(record.data),
    status: record.status,
    statusText: record.statusText,
    headers: new Headers(record.headers),
    config,
    raw: cloneRawResponse(record)
  }
}

function restoreCacheEntry(
  record: CacheEntry,
  config: RequestConfig
): NporaResponse | undefined {
  try {
    return createCachedResponse(record, config)
  } catch {
    return undefined
  }
}

function isCacheableRequest(
  config: RequestConfig,
  methods: ReadonlySet<HttpMethod>
): boolean {
  return (
    methods.has(config.method ?? 'GET') &&
    config.responseType !== 'stream' &&
    config.responseType !== 'sse' &&
    config.responseType !== 'ndjson'
  )
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
}

function isSchemaValidationFailure(error: unknown): boolean {
  return error instanceof RequestError && error.code === 'SCHEMA_ERROR'
}

function allowsPersistentCaching(response: NporaResponse): boolean {
  const cacheControl = response.headers.get('cache-control')

  if (
    cacheControl
      ?.split(',')
      .some(directive => directive.trim().toLowerCase() === 'no-store')
  ) {
    return false
  }

  return !response.headers
    .get('vary')
    ?.split(',')
    .some(name => name.trim() === '*')
}

function createCacheKey(
  config: RequestConfig,
  cache: CacheOptions,
  varyHeaders: readonly string[],
  emptyHeaderValues: ReadonlyArray<[string, string | null]>,
  memo: CacheKeyMemo
): string {
  if (cache.key) {
    return cache.key
  }

  const method = config.method ?? 'GET'
  const responseType = config.responseType ?? 'auto'
  const bare = !config.headers && !config.query && !config.searchParams

  if (
    bare &&
    memo.key !== undefined &&
    memo.method === method &&
    memo.baseURL === config.baseURL &&
    memo.url === config.url &&
    memo.responseType === responseType
  ) {
    return memo.key
  }

  const key = JSON.stringify({
    method,
    baseURL: config.baseURL,
    url: config.url,
    query: bare
      ? EMPTY_QUERY
      : normalizeQuery(config.searchParams ?? config.query),
    responseType,
    headers: config.headers
      ? normalizeCacheHeaders(
          new Headers(config.headers),
          varyHeaders
        )
      : emptyHeaderValues
  })

  if (bare) {
    memo.method = method
    memo.baseURL = config.baseURL
    memo.url = config.url
    memo.responseType = responseType
    memo.key = key
  }

  return key
}

interface CacheKeyMemo {
  method?: HttpMethod
  baseURL?: string
  url?: string
  responseType?: string
  key?: string
}

function normalizeCacheHeaders(
  headers: Headers | undefined,
  varyHeaders: readonly string[]
): Array<[string, string | null]> {
  const values: Array<[string, string | null]> = []

  headers?.forEach((value, name) => {
    values.push([name, value])
  })

  for (const name of varyHeaders) {
    if (!headers?.has(name)) {
      values.push([name, null])
    }
  }

  return values.sort(([first], [second]) => {
    return first.localeCompare(second)
  })
}

function normalizeVaryHeaders(
  headers: readonly string[]
): readonly string[] {
  return [...new Set(headers.map(name => name.toLowerCase()))]
}

function normalizeQuery(
  query?: QueryParams | URLSearchParams
): ReadonlyArray<[string, string]> {
  if (!query) {
    return EMPTY_QUERY
  }

  if (isURLSearchParams(query)) {
    return [...query.entries()]
  }

  const entries: Array<[string, string]> = []

  for (const key of Object.keys(query).sort()) {
    appendQueryValue(entries, key, query[key])
  }

  return entries
}

function appendQueryValue(
  entries: Array<[string, string]>,
  key: string,
  value: QueryParams[string]
): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(entries, key, item)
    }

    return
  }

  entries.push([key, String(value)])
}

function cloneRawResponse(record: CacheEntry): Response {
  if (record.raw) {
    const cloned = cloneResponse(record.raw)

    if (cloned) {
      return cloned
    }
  }

  return new Response(null, {
    status: record.status,
    statusText: record.statusText,
    headers: record.headers
  })
}

function cloneResponse(response: Response): Response | undefined {
  try {
    return response.clone()
  } catch {
    return undefined
  }
}

function cloneCacheValue<T>(value: T): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof structuredClone !== 'function'
  ) {
    return value
  }

  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function normalizeMaxEntries(value?: number): number {
  if (value === undefined) {
    return 1000
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.POSITIVE_INFINITY : 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeCacheTtl(
  value: number | undefined,
  config: RequestConfig
): number {
  const ttl = value ?? 30000

  if (
    ttl !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(ttl) || ttl < 0)
  ) {
    throw new RequestError(
      'Cache ttl must be a non-negative finite number or Infinity',
      {
        code: 'CONFIG_ERROR',
        config
      }
    )
  }

  return ttl
}

function isExpired(expiresAt: number): boolean {
  return expiresAt !== Number.POSITIVE_INFINITY &&
    (Number.isNaN(expiresAt) || Date.now() >= expiresAt)
}
