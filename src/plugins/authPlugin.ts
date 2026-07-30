import { RequestError } from '../errors'
import type { RequestConfig } from '../types'
import type { Plugin } from './Plugin'
import { resolveExtensionConfig } from './resolveExtensionConfig'

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
          const authorization = await resolveAuthorization(
            requestContext.config,
            options,
            typeof refreshedToken === 'string'
              ? refreshedToken
              : undefined
          )

          if (!authorization.token) {
            return undefined
          }

          requestContext.config = setAuthorizationHeader(
            requestContext.config,
            authorization.token,
            authorization.scheme
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
      refreshPromise = Promise.resolve(refreshToken())
        .then(async token => {
          if (token) {
            await options.storage?.set(token)
          }

          return token
        })
        .finally(() => {
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
  const authorization = await resolveAuthorization(config, options)

  if (!authorization.token) {
    return config
  }

  return setAuthorizationHeader(
    config,
    authorization.token,
    authorization.scheme
  )
}

async function resolveAuthorization(
  config: RequestConfig,
  options: AuthPluginOptions,
  tokenOverride?: string
): Promise<ResolvedAuthorization> {
  const requestAuth = resolveExtensionConfig(
    config,
    'auth',
    config.auth
  )

  const token =
    tokenOverride ??
    (
      requestAuth?.token
        ? await resolveToken(requestAuth.token)
        : await resolvePluginToken(options)
    )

  return {
    token,
    scheme: requestAuth?.scheme ?? options.scheme
  }
}

interface ResolvedAuthorization {
  token: string
  scheme?: string
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
