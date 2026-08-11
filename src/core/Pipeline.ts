import type {
  InterceptorManager
} from '../interceptors/InterceptorManager'
import type { PluginHooks } from '../interceptors/PluginHooks'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import { RequestError, SchemaValidationError } from '../errors'
import { validateRequestConfig } from '../utils'
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
          await this.hooks.runRequest(context)
          headers = validateRequestConfig(context.config)
        }

        validatedHeaders = headers
      } catch (error) {
        return this.fail(context, error)
      }

      if (context.response) {
        try {
          return await this.processResponse(context)
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
            await this.hooks.runTransport(context)
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

          return await this.processResponse(context)
        } catch (error) {
          const errorHooksSucceeded = await this.notifyError(
            context,
            error
          )

          if (!errorHooksSucceeded) {
            return this.fail(context, context.error, false)
          }

          if (!this.hooks.hasRetryHooks) {
            return this.fail(context, context.error, false)
          }

          let decision

          try {
            decision = await this.hooks.resolveRetry(context, attempt)
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
            await waitForRetry(
              decision.delay ?? 0,
              context.config
            )
          } catch (waitError) {
            return this.fail(context, waitError)
          }
        }
      }
    } finally {
      context.endTime = Date.now()

      if (this.hooks.hasSettledHooks) {
        try {
          await this.hooks.runSettled(context)
        } catch {
          // Final observers must not replace the request result.
        }
      }
    }
  }

  private async processResponse<T>(
    context: RequestContext<T>
  ): Promise<NporaResponse<T>> {
    if (this.hooks.hasResponseHooks) {
      await this.hooks.runResponse(context)
    }

    await this.validateResponseSchema(context)

    if (this.interceptors.response.active) {
      context.response = (await this.interceptors.response.run(
        context.response as NporaResponse
      )) as NporaResponse<T>
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

  private async notifyError<T>(
    context: RequestContext<T>,
    error: unknown
  ): Promise<boolean> {
    context.error = error

    if (this.hooks.hasErrorHooks) {
      try {
        await this.hooks.runError(context)
        return true
      } catch (hookError) {
        context.error = hookError
        return false
      }
    }

    return true
  }

  private async fail<T>(
    context: RequestContext<T>,
    error: unknown,
    notifyHooks = true
  ): Promise<never> {
    if (notifyHooks) {
      await this.notifyError(context, error)
    } else {
      context.error = error
    }

    if (this.interceptors.error.active) {
      context.error = await this.interceptors.error.run(
        context.error
      )
    }

    throw context.error
  }
}

function waitForRetry(
  milliseconds: number,
  config: RequestConfig
): Promise<void> {
  const signal = config.signal

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason, config))
  }

  if (milliseconds <= 0) {
    return Promise.resolve()
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
