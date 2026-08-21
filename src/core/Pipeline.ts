import type {
  InterceptorManager
} from '../interceptors/InterceptorManager'
import type { PluginHooks } from '../interceptors/PluginHooks'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import { RequestError, SchemaValidationError } from '../errors'
import { validateRequestConfig } from '../utils'
import { isPromiseLike } from '../utils/isPromiseLike'
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

  async execute<T = unknown>(
    config: RequestConfig,
    preserveRaw = true
  ): Promise<NporaResponse<T>> {
    const context = new RequestContext<T>(config)
    let validatedHeaders: Headers | undefined

    try {
      try {
        if (this.interceptors.request.active) {
          context.config = await this.interceptors.request.run(
            context.config
          )
        }

        let headers = validateRequestConfig(context.config)

        if (this.hooks.hasRequestHooks) {
          const hooks = this.hooks.runRequest(context)

          if (isPromiseLike(hooks)) {
            await hooks
          }

          headers = validateRequestConfig(context.config)
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
                    preserveRaw ||
                    this.hooks.hasResponseHooks ||
                    this.interceptors.response.active
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
            return this.fail(context, context.error, false)
          }

          context.error = undefined
          context.response = undefined
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
      return this.interceptors.response.run(
        context.response as NporaResponse
      ).then(response => {
        context.response = response as NporaResponse<T>
        return context.response
      })
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
      return this.interceptors.error.run(
        context.error
      ).then(error => {
        context.error = error
        throw context.error
      })
    }

    throw context.error
  }
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
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, milliseconds)

    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(createAbortError(signal?.reason, config))
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, {
      once: true
    })
  })
}

function createAbortError(
  reason: unknown,
  config: RequestConfig
): RequestError {
  if (reason instanceof RequestError) {
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
