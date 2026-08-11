import type {
  CacheOptions,
  HttpMethod,
  NporaResponse,
  QueryParams,
  RequestConfig
} from '../types'
import { RequestError } from '../errors'
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
      return undefined
    }

    this.entries.delete(key)
    this.entries.set(key, entry)

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
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
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

export function cachePlugin(
  options: CachePluginOptions = {}
): CachePlugin {
  const store = options.store ?? new MemoryCacheStore({
    maxEntries: options.maxEntries
  })
  const cacheHits = new WeakSet<object>()
  const leaders = new WeakMap<object, string>()
  const completedRecords = new WeakMap<object, CacheEntry>()
  const uncacheableLeaders = new WeakSet<object>()
  const inFlight = new Map<string, InFlightRequest>()
  const methods = new Set(
    options.methods ?? DEFAULT_CACHE_METHODS
  )
  const varyHeaders =
    options.varyHeaders ?? DEFAULT_VARY_HEADERS

  const plugin: CachePlugin = {
    name: 'cache',

    clear() {
      return store.clear()
    },

    install(context) {
      const ownedLeaders = new Set<object>()
      let active = true

      context.hooks.onRequest(async requestContext => {
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

        const key = createCacheKey(
          requestContext.config,
          cache,
          varyHeaders
        )
        const record = await readStore(store, key)

        if (!active) {
          return
        }

        if (record) {
          if (isExpired(record.expiresAt)) {
            await deleteStore(store, key)
          } else {
            const cachedResponse = restoreCacheEntry(
              record,
              requestContext.config
            )

            if (cachedResponse) {
              requestContext.response = cachedResponse
              cacheHits.add(requestContext)
              return
            }

            await deleteStore(store, key)
          }
        }

        if (!(cache.dedupe ?? options.dedupe ?? true)) {
          return
        }

        const pending = inFlight.get(key)

        if (pending) {
          const sharedRecord = await waitForSharedRecord(
            pending.promise,
            requestContext.config
          )

          if (!sharedRecord) {
            return
          }

          requestContext.response = createCachedResponse(
            sharedRecord,
            requestContext.config
          )
          cacheHits.add(requestContext)
          return
        }

        const created = createInFlightRequest(requestContext)

        inFlight.set(key, created)
        leaders.set(requestContext, key)
        ownedLeaders.add(requestContext)
      })

      context.hooks.onResponse(async requestContext => {
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

        const key = createCacheKey(
          requestContext.config,
          cache,
          varyHeaders
        )

        if (isAsyncIterable(requestContext.response.data)) {
          uncacheableLeaders.add(requestContext)
          await deleteStore(store, key)
          return
        }

        const ttl = normalizeCacheTtl(
          cache.ttl,
          requestContext.config
        )
        const record = createCacheEntry(
          requestContext.response,
          Date.now() + Math.max(0, ttl)
        )

        completedRecords.set(requestContext, record)

        if (
          ttl <= 0 ||
          !allowsPersistentCaching(requestContext.response)
        ) {
          await deleteStore(store, key)
          return
        }

        await writeStore(store, key, record)
      })

      context.hooks.onSettled(requestContext => {
        const key = leaders.get(requestContext)

        if (!key) {
          return
        }

        leaders.delete(requestContext)
        ownedLeaders.delete(requestContext)

        const pending = inFlight.get(key)

        if (!pending || pending.owner !== requestContext) {
          return
        }

        inFlight.delete(key)

        if (uncacheableLeaders.delete(requestContext)) {
          pending.resolve(undefined)
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
          pending.resolve(record)
          return
        }

        pending.reject(
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
          const key = leaders.get(owner)

          leaders.delete(owner)

          if (!key) {
            continue
          }

          const pending = inFlight.get(key)

          if (!pending || pending.owner !== owner) {
            continue
          }

          inFlight.delete(key)
          pending.reject(
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
  owner: object

  promise: Promise<CacheEntry | undefined>

  resolve(entry: CacheEntry | undefined): void

  reject(error: unknown): void
}

function createInFlightRequest(owner: object): InFlightRequest {
  let resolve!: (entry: CacheEntry | undefined) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<CacheEntry | undefined>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    }
  )

  void promise.catch(() => {})

  return {
    owner,
    promise,
    resolve,
    reject
  }
}

async function readStore(
  store: CacheStore,
  key: string
): Promise<CacheEntry | undefined> {
  try {
    return await store.get(key)
  } catch {
    return undefined
  }
}

async function writeStore(
  store: CacheStore,
  key: string,
  entry: CacheEntry
): Promise<void> {
  try {
    await store.set(key, entry)
  } catch {
    // Cache storage failures must not change the network response.
  }
}

async function deleteStore(
  store: CacheStore,
  key: string
): Promise<void> {
  try {
    await store.delete(key)
  } catch {
    // Expired or disabled cache entries can be ignored safely.
  }
}

async function waitForSharedRecord(
  promise: Promise<CacheEntry | undefined>,
  config: RequestConfig
): Promise<CacheEntry | undefined> {
  const signal = config.signal

  if (!signal) {
    try {
      return await promise
    } catch (error) {
      throw cloneSharedError(error, config)
    }
  }

  if (signal.aborted) {
    throw createSharedAbortError(signal.reason, config)
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(createSharedAbortError(signal.reason, config))
    }

    signal.addEventListener('abort', onAbort, {
      once: true
    })
    promise.then(
      entry => {
        cleanup()
        resolve(entry)
      },
      error => {
        cleanup()
        reject(cloneSharedError(error, config))
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
  expiresAt: number
): CacheEntry {
  return {
    data: cloneCacheValue(response.data),
    expiresAt,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    raw: cloneResponse(response.raw)
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
  varyHeaders: readonly string[]
): string {
  if (cache.key) {
    return cache.key
  }

  const headers = new Headers(config.headers)

  return JSON.stringify({
    method: config.method ?? 'GET',
    baseURL: config.baseURL,
    url: config.url,
    query: normalizeQuery(config.query),
    responseType: config.responseType ?? 'auto',
    headers: normalizeCacheHeaders(headers, varyHeaders)
  })
}

function normalizeCacheHeaders(
  headers: Headers,
  varyHeaders: readonly string[]
): Array<[string, string | null]> {
  const values = new Map<string, string | null>()

  headers.forEach((value, name) => {
    values.set(name.toLowerCase(), value)
  })

  for (const name of varyHeaders) {
    const normalizedName = name.toLowerCase()

    if (!values.has(normalizedName)) {
      values.set(normalizedName, headers.get(name))
    }
  }

  return [...values.entries()].sort(([first], [second]) => {
    return first.localeCompare(second)
  })
}

function normalizeQuery(
  query?: QueryParams
): Array<[string, string]> {
  if (!query) {
    return []
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
  if (typeof structuredClone !== 'function') {
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
  return Number.isNaN(expiresAt) || Date.now() > expiresAt
}
