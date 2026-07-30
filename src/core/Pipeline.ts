import type {
  InterceptorManager
} from '../interceptors/InterceptorManager'
import type { PluginHooks } from '../interceptors/PluginHooks'
import type { Adapter, NporaResponse, RequestConfig } from '../types'
import { RequestError } from '../errors'
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

  async execute<T = unknown>(config: RequestConfig): Promise<NporaResponse<T>> {
    const context = new RequestContext<T>(config)

    try {
      try {
        if (this.interceptors.request.active) {
          context.config = await this.interceptors.request.run(
            context.config
          )
        }

        validateRequestConfig(context.config)

        if (this.hooks.hasRequestHooks) {
          await this.hooks.runRequest(context)
          validateRequestConfig(context.config)
        }
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
          context.response = await this.adapter.request<T>(context.config)
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
    }
  }

  private async processResponse<T>(
    context: RequestContext<T>
  ): Promise<NporaResponse<T>> {
    if (this.hooks.hasResponseHooks) {
      await this.hooks.runResponse(context)
    }

    if (this.interceptors.response.active) {
      context.response = (await this.interceptors.response.run(
        context.response as NporaResponse
      )) as NporaResponse<T>
    }

    return context.response as NporaResponse<T>
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
