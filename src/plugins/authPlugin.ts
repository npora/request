import { RequestError } from '../errors'
import type { RequestConfig } from '../types'
import type { Plugin } from './Plugin'

type MaybePromise<T> = T | Promise<T>

/**
 * Token storage used by the authentication extension.
 *
 * Storage implementation is supplied by the application.
 * The request library does not access localStorage or sessionStorage directly.
 */
export interface AuthTokenStorage {
  get(): MaybePromise<string | null | undefined>

  set(token: string): MaybePromise<void>

  remove(): MaybePromise<void>
}

export interface AuthPluginOptions {
  /**
   * Access token or access-token provider.
   *
   * When both token and storage are provided,
   * the request-level token has the highest priority,
   * followed by this token option, then storage.
   */
  token?: string | (() => MaybePromise<string>)

  /**
   * Authorization scheme.
   *
   * @default 'Bearer'
   */
  scheme?: string

  /**
   * Optional access-token storage.
   */
  storage?: AuthTokenStorage

  /**
   * Refresh the access token.
   *
   * Returning a token stores it through storage when configured.
   * Returning void allows the callback to update external state itself.
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

          if (refreshedToken) {
            await options.storage?.set(refreshedToken)
          }

          const token =
            refreshedToken || (await resolvePluginToken(options))

          if (!token) {
            return undefined
          }

          requestContext.config = setAuthorizationHeader(
            requestContext.config,
            token,
            options.scheme
          )

          return {
            retry: true,
            delay: 0
          }
        } catch {
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

  const token = requestAuth?.token
    ? await resolveToken(requestAuth.token)
    : await resolvePluginToken(options)

  if (!token) {
    return config
  }

  return setAuthorizationHeader(
    config,
    token,
    requestAuth?.scheme ?? options.scheme
  )
}

async function resolvePluginToken(
  options: AuthPluginOptions
): Promise<string> {
  const configuredToken = await resolveToken(options.token)

  if (configuredToken) {
    return configuredToken
  }

  const storedToken = await options.storage?.get()

  return storedToken ?? ''
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
