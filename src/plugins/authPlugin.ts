import { RequestError } from '../errors'
import type { RequestConfig } from '../types'
import type { Plugin } from './Plugin'

type MaybePromise<T> = T | Promise<T>

export interface AuthPluginOptions {
  /**
   * Access token or access-token provider.
   */
  token?: string | (() => MaybePromise<string>)

  /**
   * Authorization scheme.
   *
   * @default 'Bearer'
   */
  scheme?: string

  /**
   * Refresh the access token.
   *
   * The callback may return the refreshed token directly,
   * or update external token storage and return void.
   */
  refreshToken?: () => MaybePromise<string | void>

  /**
   * Determine whether an error should trigger token refresh.
   *
   * @default HTTP status 401
   */
  shouldRefresh?: (error: unknown) => MaybePromise<boolean>
}

/**
 * Authentication plugin.
 *
 * Adds the Authorization header and optionally refreshes
 * an expired access token after an unauthorized response.
 */
export function authPlugin(options: AuthPluginOptions = {}): Plugin {
  let refreshPromise: Promise<string | void> | undefined

  const refreshedContexts = new WeakSet<object>()

  return {
    name: 'auth',

    install(context) {
      context.interceptors.request.use(async config => {
        return applyAuthorization(config, options)
      })

      context.hooks.onRetry(async requestContext => {
        if (!options.refreshToken || !requestContext.error) {
          return undefined
        }

        if (refreshedContexts.has(requestContext)) {
          return undefined
        }

        const shouldRefresh =
          options.shouldRefresh ?? defaultShouldRefresh

        if (!(await shouldRefresh(requestContext.error))) {
          return undefined
        }

        refreshedContexts.add(requestContext)

        try {
          const refreshedToken = await refreshAccessToken(
            options.refreshToken
          )

          const token =
            refreshedToken || (await resolveToken(options.token))

          if (token) {
            requestContext.config = setAuthorizationHeader(
              requestContext.config,
              token,
              options.scheme
            )
          }

          return {
            retry: true,
            delay: 0
          }
        } catch {
          // Preserve the original HTTP error when refresh fails.
          return undefined
        }
      })
    }
  }

  async function refreshAccessToken(
    refreshToken: NonNullable<AuthPluginOptions['refreshToken']>
  ): Promise<string | void> {
    if (!refreshPromise) {
      refreshPromise = Promise.resolve(refreshToken()).finally(() => {
        refreshPromise = undefined
      })
    }

    return refreshPromise
  }
}

async function applyAuthorization(
  config: RequestConfig,
  options: AuthPluginOptions
): Promise<RequestConfig> {
  const requestAuth = config.auth
  const token = await resolveToken(requestAuth?.token ?? options.token)

  if (!token) {
    return config
  }

  return setAuthorizationHeader(
    config,
    token,
    requestAuth?.scheme ?? options.scheme
  )
}

async function resolveToken(
  token?: string | (() => MaybePromise<string>)
): Promise<string> {
  if (!token) {
    return ''
  }

  return typeof token === 'function'
    ? await token()
    : token
}

function setAuthorizationHeader(
  config: RequestConfig,
  token: string,
  scheme = 'Bearer'
): RequestConfig {
  const headers = new Headers(config.headers)

  headers.set('authorization', `${scheme} ${token}`)

  return {
    ...config,
    headers
  }
}

function defaultShouldRefresh(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === 'HTTP_ERROR' &&
    error.status === 401
  )
}
