import type {
  InterceptorManager
} from '../interceptors/InterceptorManager'
import type { PluginHooks } from '../interceptors/PluginHooks'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import {
  isRequestError,
  RequestError,
  SchemaValidationError
} from '../errors'
import {
  finalizeStreamingResponse,
  validateRequestConfig
} from '../utils'
import { createTimeoutSignal } from '../utils/createTimeoutSignal'
import { throwIfAborted } from '../utils/createAbortError'
import { isPromiseLike } from '../utils/isPromiseLike'
import { MAX_TIMER_DELAY } from '../utils/maxTimerDelay'
import { normalizeURL } from '../utils/normalizeURL'
import { waitForSignal } from '../utils/waitForSignal'
import { isReadableStream } from '../utils/isReadableStream'
import { RequestContext } from './RequestContext'

export interface PipelineInterceptors {
  request: InterceptorManager<RequestConfig>
  response: InterceptorManager<NporaResponse>
  error: InterceptorManager<unknown>
}

/**
 * Coordinates the request lifecycle.
 *
 * Pipeline does not implement business features.
 */
export class Pipeline {
  constructor(
    private readonly adapter: Adapter,
    private readonly interceptors: PipelineInterceptors,
    private readonly hooks: PluginHooks
  ) {}

  execute<T = unknown>(
    config: RequestConfig,
    preserveRaw = true,
    background = false
  ): Promise<NporaResponse<T>> {
    const normalizedURL = normalizeURL(config.url)

    if (
      normalizedURL !== undefined &&
      normalizedURL !== config.url
    ) {
      config = {
        ...config,
        url: normalizedURL
      }
    }

    const totalTimeout = config.totalTimeout

    if (
      typeof totalTimeout === 'number' &&
      Number.isFinite(totalTimeout) &&
      totalTimeout > 0 &&
      totalTimeout <= MAX_TIMER_DELAY
    ) {
      let timeoutSignal

      try {
        timeoutSignal = createTimeoutSignal(
          config.signal,
          totalTimeout,
          `Request total timeout after ${totalTimeout}ms`
        )
      } catch (error) {
        return Promise.reject(new RequestError(
          'Failed to configure request totalTimeout',
          {
            code: 'CONFIG_ERROR',
            config,
            cause: error
          }
        ))
      }

      const effectiveConfig = {
        ...config,
        signal: timeoutSignal.signal
      }

      return waitForSignal(
        () => this.executeConfigured<T>(
          effectiveConfig,
          preserveRaw,
          background
        ),
        effectiveConfig
      ).then(
        response => finalizeTotalTimeout(response, timeoutSignal.clear),
        error => {
          timeoutSignal.clear()
          throw error
        }
      )
    }

    return this.executeConfigured<T>(config, preserveRaw, background)
  }

  private executeConfigured<T>(
    config: RequestConfig,
    preserveRaw: boolean,
    background: boolean
  ): Promise<NporaResponse<T>> {
    if (
      !config.schema &&
      !this.hooks.active &&
      !this.interceptors.request.active &&
      !this.interceptors.response.active &&
      !this.interceptors.error.active
    ) {
      try {
        const headers = validateRequestConfig(
          config,
          !!this.adapter.requestValidated
        )

        throwIfAborted(config)

        return this.adapter.requestValidated
          ? this.adapter.requestValidated<T>(
              config,
              headers!,
              preserveRaw
            )
          : this.adapter.request<T>(config)
      } catch (error) {
        return Promise.reject(error)
      }
    }

    return this.executeLifecycle<T>(config, preserveRaw, background)
  }

  private async executeLifecycle<T>(
    config: RequestConfig,
    preserveRaw: boolean,
    background: boolean
  ): Promise<NporaResponse<T>> {
    const context = new RequestContext<T>(
      config,
      preserveRaw ||
      this.hooks.hasRawResponseHooks ||
      this.interceptors.response.active,
      background
    )
    const headersRequired = !!this.adapter.requestValidated
    let validatedHeaders: Headers | undefined

    try {
      try {
        if (this.interceptors.request.active) {
          const intercepted = (
            this.interceptors.request as unknown as InternalInterceptorManager<
              RequestConfig
            >
          ).runMaybeAsync(context.config)

          context.config = isPromiseLike(intercepted)
            ? await intercepted
            : intercepted
        }

        let headers = validateRequestConfig(
          context.config,
          headersRequired
        )

        if (this.hooks.hasRequestHooks) {
          const hooks = this.hooks.runRequest(context)

          if (isPromiseLike(hooks)) {
            await hooks
          }

          headers = validateRequestConfig(
            context.config,
            headersRequired
          )
        }

        validatedHeaders = headers
      } catch (error) {
        return this.fail(context, error)
      }

      if (context.response) {
        try {
          const response = this.processResponse(context)
          return isPromiseLike(response)
            ? await response
            : response
        } catch (error) {
          return this.fail(context, error)
        }
      }

      let attempt = 0

      while (true) {
        try {
          const headers = validatedHeaders

          validatedHeaders = undefined

          throwIfAborted(context.config)

          if (this.hooks.hasTransportHooks) {
            const hooks = this.hooks.runTransport(context)

            if (isPromiseLike(hooks)) {
              await hooks
            }
          }

          if (!context.response) {
            context.response =
              headers && this.adapter.requestValidated
                ? await this.adapter.requestValidated<T>(
                    context.config,
                    headers,
                    context.preserveRaw
                  )
                : await this.adapter.request<T>(
                    context.config
                  )
          }

          const response = this.processResponse(context)
          return isPromiseLike(response)
            ? await response
            : response
        } catch (error) {
          const errorHooks = this.notifyError(
            context,
            error
          )
          const errorHooksSucceeded = isPromiseLike(errorHooks)
            ? await errorHooks
            : errorHooks

          if (!errorHooksSucceeded) {
            return this.fail(context, context.error, false)
          }

          if (!this.hooks.hasRetryHooks) {
            if (context.fallbackResponse) {
              return this.recoverFromError(context)
            }

            return this.fail(context, context.error, false)
          }

          let decision

          try {
            const resolved = this.hooks.resolveRetry(context, attempt)

            decision = isPromiseLike(resolved)
              ? await resolved
              : resolved
          } catch (retryError) {
            return this.fail(context, retryError)
          }

          if (!decision.retry) {
            if (context.fallbackResponse) {
              return this.recoverFromError(context)
            }

            return this.fail(context, context.error, false)
          }

          context.error = undefined
          context.response = undefined
          context.fallbackResponse = undefined
          attempt += 1
          context.attempt = attempt

          try {
            const wait = waitForRetry(
              decision.delay ?? 0,
              context.config
            )

            if (wait) {
              await wait
            }
          } catch (waitError) {
            return this.fail(context, waitError)
          }
        }
      }
    } finally {
      context.endTime = Date.now()

      if (this.hooks.hasSettledHooks) {
        try {
          const hooks = this.hooks.runSettled(context)

          if (isPromiseLike(hooks)) {
            await hooks
          }
        } catch {
          // Final observers must not replace the request result.
        }
      }
    }
  }

  private processResponse<T>(
    context: RequestContext<T>
  ): NporaResponse<T> | Promise<NporaResponse<T>> {
    if (this.hooks.hasResponseHooks) {
      const hooks = this.hooks.runResponse(context)

      if (isPromiseLike(hooks)) {
        return Promise.resolve(hooks).then(() => {
          return this.processValidatedResponse(context)
        })
      }
    }

    return this.processValidatedResponse(context)
  }

  private async recoverFromError<T>(
    context: RequestContext<T>
  ): Promise<NporaResponse<T>> {
    context.response = context.fallbackResponse
    context.error = undefined

    try {
      const response = this.processResponse(context)

      return isPromiseLike(response)
        ? await response
        : response
    } catch (error) {
      return this.fail(context, error)
    } finally {
      context.fallbackResponse = undefined
    }
  }

  private processValidatedResponse<T>(
    context: RequestContext<T>
  ): NporaResponse<T> | Promise<NporaResponse<T>> {
    if (context.config.schema && context.response) {
      return this.validateResponseSchema(context).then(() => {
        return this.processResponseInterceptors(context)
      })
    }

    return this.processResponseInterceptors(context)
  }

  private processResponseInterceptors<T>(
    context: RequestContext<T>
  ): NporaResponse<T> | Promise<NporaResponse<T>> {
    if (this.interceptors.response.active) {
      const intercepted = (
        this.interceptors.response as unknown as InternalInterceptorManager<
          NporaResponse
        >
      ).runMaybeAsync(context.response as NporaResponse)

      if (isPromiseLike(intercepted)) {
        return Promise.resolve(intercepted).then(response => {
          context.response = response as NporaResponse<T>
          return context.response
        })
      }

      context.response = intercepted as NporaResponse<T>
      return context.response
    }

    return context.response as NporaResponse<T>
  }

  private async validateResponseSchema<T>(
    context: RequestContext<T>
  ): Promise<void> {
    const schema = context.config.schema
    const response = context.response

    if (!schema || !response) {
      return
    }

    let result: Awaited<ReturnType<typeof schema['~standard']['validate']>>
    let schemaVendor = 'unknown'

    try {
      const standard = schema['~standard']

      schemaVendor = standard.vendor
      result = await standard.validate(response.data)
    } catch (error) {
      throw new SchemaValidationError(
        'Response schema validator failed',
        response,
        schemaVendor,
        [],
        error
      )
    }

    if (
      typeof result !== 'object' ||
      result === null
    ) {
      throw new SchemaValidationError(
        'Response schema validator returned an invalid result',
        response,
        schemaVendor,
        [],
        new TypeError('Expected a Standard Schema result')
      )
    }

    const issues = 'issues' in result ? result.issues : undefined

    if (issues !== undefined) {
      if (!Array.isArray(issues)) {
        throw new SchemaValidationError(
          'Response schema validator returned an invalid result',
          response,
          schemaVendor,
          [],
          new TypeError('Expected Standard Schema issues to be an array')
        )
      }

      throw new SchemaValidationError(
        'Response schema validation failed',
        response,
        schemaVendor,
        issues
      )
    }

    if (!('value' in result)) {
      throw new SchemaValidationError(
        'Response schema validator returned an invalid result',
        response,
        schemaVendor,
        [],
        new TypeError('Expected a Standard Schema value')
      )
    }

    context.response = {
      ...response,
      data: result.value as T
    }
  }

  private notifyError<T>(
    context: RequestContext<T>,
    error: unknown
  ): boolean | Promise<boolean> {
    context.error = error

    if (this.hooks.hasErrorHooks) {
      try {
        const hooks = this.hooks.runError(context)

        if (isPromiseLike(hooks)) {
          return Promise.resolve(hooks).then(
            () => true,
            hookError => {
              context.error = hookError
              return false
            }
          )
        }

        return true
      } catch (hookError) {
        context.error = hookError
        return false
      }
    }

    return true
  }

  private fail<T>(
    context: RequestContext<T>,
    error: unknown,
    notifyHooks = true
  ): never | Promise<never> {
    if (notifyHooks) {
      const hooks = this.notifyError(context, error)

      if (isPromiseLike(hooks)) {
        return Promise.resolve(hooks).then(() => {
          return this.completeFailure(context)
        })
      }
    } else {
      context.error = error
    }

    return this.completeFailure(context)
  }

  private completeFailure<T>(
    context: RequestContext<T>
  ): never | Promise<never> {
    if (this.interceptors.error.active) {
      const intercepted = (
        this.interceptors.error as unknown as InternalInterceptorManager<
          unknown
        >
      ).runMaybeAsync(context.error)

      if (isPromiseLike(intercepted)) {
        return Promise.resolve(intercepted).then(error => {
          context.error = error
          throw context.error
        })
      }

      context.error = intercepted
      throw context.error
    }

    throw context.error
  }
}

interface InternalInterceptorManager<T> {
  runMaybeAsync(value: T): T | Promise<T>
}

function waitForRetry(
  milliseconds: number,
  config: RequestConfig
): Promise<void> | undefined {
  const signal = config.signal

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason, config))
  }

  if (milliseconds <= 0) {
    return undefined
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const onAbort = () => {
      if (settled) {
        return
      }

      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      cleanup()
      reject(createAbortError(signal?.reason, config))
    }

    const cleanup = () => {
      try {
        signal?.removeEventListener('abort', onAbort)
      } catch {
        // Cleanup failures must not retain a retry wait.
      }
    }

    try {
      signal?.addEventListener('abort', onAbort, {
        once: true
      })
    } catch (error) {
      if (!settled) {
        settled = true
        cleanup()
        reject(error)
      }
      return
    }

    if (signal?.aborted) {
      onAbort()
    }

    if (settled) {
      return
    }

    try {
      timer = setTimeout(() => {
        settled = true
        cleanup()
        resolve()
      }, Math.min(milliseconds, MAX_TIMER_DELAY))
    } catch (error) {
      settled = true
      cleanup()
      reject(error)
      return
    }

    if (settled) {
      clearTimeout(timer)
      timer = undefined
    }
  })
}

function createAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  if (isRequestError(reason)) {
    return new RequestError(reason.message, {
      code: reason.code,
      status: reason.status,
      data: reason.data,
      response: reason.response,
      config: reason.config ?? config,
      cause: reason
    })
  }

  return new RequestError('Request aborted during retry delay', {
    code: 'ABORT_ERROR',
    config,
    cause: reason
  })
}

function finalizeTotalTimeout<T>(
  response: NporaResponse<T>,
  clear: () => void
): NporaResponse<T> {
  const data = response.data

  if (isReadableStream(data)) {
    const source = data === response.raw.body
      ? response.raw
      : new Response(data, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        })
    const raw = finalizeStreamingResponse(
      source,
      undefined,
      response.config,
      clear
    )

    return {
      ...response,
      data: raw.body as T,
      raw
    }
  }

  if (isAsyncIterable(data)) {
    return {
      ...response,
      data: finalizeAsyncIterable(data, clear) as T
    }
  }

  clear()
  return response
}

function finalizeAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  clear: () => void
): AsyncIterable<T> {
  return (async function* () {
    try {
      yield* iterable
    } finally {
      clear()
    }
  })()
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
}
