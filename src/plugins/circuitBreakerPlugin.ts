import { RequestError } from '../errors'
import type {
  CircuitBreakerStateChange,
  CircuitState,
  RequestConfig
} from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

export interface CircuitBreakerPluginOptions {
  /**
   * Consecutive counted failures required to open a closed circuit.
   *
   * @default 5
   */
  failureThreshold?: number

  /**
   * Successful probes required to close a half-open circuit.
   *
   * @default 1
   */
  successThreshold?: number

  /**
   * Time in milliseconds before an open circuit permits probes.
   *
   * @default 30000
   */
  resetTimeout?: number

  /**
   * Maximum concurrent probes admitted while a circuit is half-open.
   *
   * @default 1
   */
  halfOpenMaxRequests?: number

  /**
   * Create the default isolation key for a request.
   *
   * @default the resolved request origin or "default"
   */
  createKey?: (config: RequestConfig) => string

  /**
   * Decide whether a final request failure affects the circuit.
   *
   * @default network errors, timeouts, HTTP 429, and HTTP 5xx
   */
  shouldCountFailure?: (
    error: unknown,
    config: RequestConfig
  ) => boolean | Promise<boolean>

  /**
   * Observe circuit state changes. Observer failures are isolated.
   */
  onStateChange?: (
    event: Readonly<CircuitBreakerStateChange>
  ) => void | Promise<void>
}

export interface CircuitBreakerPlugin extends Plugin {
  getState(key: string): CircuitState

  reset(key?: string): void
}

interface CircuitRecord {
  state: CircuitState
  failures: number
  successes: number
  openedAt: number
  probes: number
  generation: number
}

interface Admission {
  key: string
  generation: number
  probe: boolean
}

interface NormalizedOptions {
  failureThreshold: number
  successThreshold: number
  resetTimeout: number
  halfOpenMaxRequests: number
  createKey: (config: RequestConfig) => string
  shouldCountFailure: NonNullable<
    CircuitBreakerPluginOptions['shouldCountFailure']
  >
  onStateChange?: CircuitBreakerPluginOptions['onStateChange']
}

export function circuitBreakerPlugin(
  options: CircuitBreakerPluginOptions = {}
): CircuitBreakerPlugin {
  const normalized = normalizeOptions(options)
  const circuits = new Map<string, CircuitRecord>()

  const plugin: CircuitBreakerPlugin = {
    name: 'circuit-breaker',

    getState(key) {
      return circuits.get(key)?.state ?? 'closed'
    },

    reset(key) {
      if (key === undefined) {
        circuits.clear()
        return
      }

      circuits.delete(key)
    },

    install(context) {
      const admissions = new WeakMap<object, Admission>()
      let active = true

      context.hooks.onRequest(requestContext => {
        const requestOptions = resolveExtensionConfig(
          requestContext.config,
          'circuitBreaker'
        )

        if (requestOptions?.enabled === false) {
          return
        }

        const key = normalizeKey(
          requestOptions?.key ?? normalized.createKey(requestContext.config)
        )
        const record = getCircuit(circuits, key)

        if (
          record.state === 'open' &&
          Date.now() - record.openedAt >= normalized.resetTimeout
        ) {
          transition(record, key, 'half-open', normalized)
        }

        if (record.state === 'open') {
          throw createOpenError(key, requestContext.config)
        }

        const probe = record.state === 'half-open'

        if (probe && record.probes >= normalized.halfOpenMaxRequests) {
          throw createOpenError(key, requestContext.config)
        }

        if (probe) {
          record.probes += 1
        }

        admissions.set(requestContext, {
          key,
          generation: record.generation,
          probe
        })
      })

      context.hooks.onSettled(async requestContext => {
        const admission = admissions.get(requestContext)

        if (!admission) {
          return
        }

        admissions.delete(requestContext)

        if (!active) {
          return
        }

        const record = circuits.get(admission.key)

        if (!record || record.generation !== admission.generation) {
          return
        }

        if (admission.probe) {
          record.probes = Math.max(0, record.probes - 1)
        }

        if (!requestContext.error && requestContext.response) {
          record.failures = 0

          if (admission.probe && record.state === 'half-open') {
            record.successes += 1

            if (record.successes >= normalized.successThreshold) {
              transition(record, admission.key, 'closed', normalized)
            }
          }

          return
        }

        const counted = await normalized.shouldCountFailure(
          requestContext.error,
          requestContext.config
        )

        if (
          !active ||
          circuits.get(admission.key) !== record ||
          record.generation !== admission.generation ||
          !counted
        ) {
          return
        }

        if (admission.probe && record.state === 'half-open') {
          transition(record, admission.key, 'open', normalized)
          return
        }

        if (record.state === 'closed') {
          record.failures += 1

          if (record.failures >= normalized.failureThreshold) {
            transition(record, admission.key, 'open', normalized)
          }
        }
      })

      return () => {
        active = false
        circuits.clear()
      }
    }
  }

  return plugin
}

function normalizeOptions(
  options: CircuitBreakerPluginOptions
): NormalizedOptions {
  return {
    failureThreshold: normalizePositiveInteger(
      options.failureThreshold,
      5
    ),
    successThreshold: normalizePositiveInteger(
      options.successThreshold,
      1
    ),
    resetTimeout: normalizeDuration(options.resetTimeout, 30000),
    halfOpenMaxRequests: normalizePositiveInteger(
      options.halfOpenMaxRequests,
      1
    ),
    createKey: options.createKey ?? createDefaultKey,
    shouldCountFailure:
      options.shouldCountFailure ?? defaultShouldCountFailure,
    onStateChange: options.onStateChange
  }
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

function normalizeDuration(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? Number.MAX_SAFE_INTEGER : 0
  }

  return Math.max(0, value)
}

function normalizeKey(key: string): string {
  return key || 'default'
}

function createDefaultKey(config: RequestConfig): string {
  try {
    return new URL(config.url).origin
  } catch {
    // Resolve a relative request only when its base is absolute.
  }

  try {
    if (config.baseURL) {
      return new URL(config.url, config.baseURL).origin
    }
  } catch {
    // Relative bases do not provide a safe origin isolation key.
  }

  return 'default'
}

function getCircuit(
  circuits: Map<string, CircuitRecord>,
  key: string
): CircuitRecord {
  let record = circuits.get(key)

  if (!record) {
    record = {
      state: 'closed',
      failures: 0,
      successes: 0,
      openedAt: 0,
      probes: 0,
      generation: 0
    }
    circuits.set(key, record)
  }

  return record
}

function transition(
  record: CircuitRecord,
  key: string,
  state: CircuitState,
  options: NormalizedOptions
): void {
  if (record.state === state) {
    if (state === 'open') {
      record.openedAt = Date.now()
      record.successes = 0
      record.probes = 0
      record.generation += 1
    }

    return
  }

  const previousState = record.state

  record.state = state
  record.successes = 0
  record.probes = 0
  record.generation += 1

  if (state === 'open') {
    record.openedAt = Date.now()
  } else if (state === 'closed') {
    record.failures = 0
    record.openedAt = 0
  }

  notifyStateChange(options.onStateChange, {
    key,
    previousState,
    state,
    timestamp: Date.now(),
    failures: record.failures
  })
}

function notifyStateChange(
  observer: CircuitBreakerPluginOptions['onStateChange'],
  event: CircuitBreakerStateChange
): void {
  if (!observer) {
    return
  }

  try {
    void Promise.resolve(observer(event)).catch(ignoreObserverError)
  } catch {
    // State observers must not affect request behavior.
  }
}

function ignoreObserverError(): void {}

function createOpenError(
  key: string,
  config: RequestConfig
): RequestError {
  return new RequestError(`Circuit is open for ${key}`, {
    code: 'CIRCUIT_OPEN',
    config
  })
}

function defaultShouldCountFailure(error: unknown): boolean {
  if (!(error instanceof RequestError)) {
    return true
  }

  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT_ERROR') {
    return true
  }

  return (
    error.code === 'HTTP_ERROR' &&
    (error.status === 429 || (error.status !== undefined && error.status >= 500))
  )
}
