import { isRequestError } from '../errors'
import type { RequestContext } from '../core/RequestContext'
import type { RequestConfig } from '../types'
import type { Plugin } from './Plugin'
import { createAbortError } from '../utils/createAbortError'
import { isPromiseLike } from '../utils/isPromiseLike'
import { waitForSignal } from '../utils/waitForSignal'
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
      let active = true

      context.interceptors.request.use(config => {
        return config.signal
          ? waitForSignal(
              () => applyAuthorization(config, options),
              config
            )
          : applyAuthorization(config, options)
      })

      context.hooks.onRetry(requestContext => {
        const refreshToken = options.refreshToken

        if (!refreshToken || !requestContext.error) {
          return undefined
        }

        if (refreshedContexts.has(requestContext)) {
          return undefined
        }

        if (options.shouldRefresh) {
          return waitForSignal(
            () => Promise.resolve(
              options.shouldRefresh!(requestContext.error)
            ),
            requestContext.config
          ).then(shouldRefreshToken => {
            return active && shouldRefreshToken
              ? refreshRequest(requestContext, refreshToken)
              : undefined
          })
        }

        if (!defaultShouldRefresh(requestContext.error)) {
          return undefined
        }

        return refreshRequest(requestContext, refreshToken)
      })

      async function refreshRequest(
        requestContext: RequestContext<unknown>,
        refreshToken: NonNullable<AuthPluginOptions['refreshToken']>
      ): Promise<{ retry: true; delay: 0 } | undefined> {
        refreshedContexts.add(requestContext)

        try {
          const refreshedToken = await waitForSignal(
            () => refreshAccessToken(refreshToken),
            requestContext.config
          )

          if (!active) {
            return undefined
          }

          const resolvedAuthorization = resolveAuthorization(
            requestContext.config,
            options,
            typeof refreshedToken === 'string'
              ? refreshedToken
              : undefined
          )
          const authorization = isPromiseLike(resolvedAuthorization)
            ? await waitForSignal(
                () => Promise.resolve(resolvedAuthorization),
                requestContext.config
              )
            : resolvedAuthorization

          if (!active || !authorization.token) {
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
        } catch (error) {
          const signal = requestContext.config.signal

          if (signal?.aborted) {
            if (isRequestError(error)) {
              throw error
            }

            throw createAbortError(
              signal.reason,
              requestContext.config,
              error
            )
          }

          return undefined
        }
      }

      return () => {
        active = false
      }
    }
  }

  async function refreshAccessToken(
    refreshToken: NonNullable<AuthPluginOptions['refreshToken']>
  ): Promise<string | void> {
    if (!refreshPromise) {
      refreshPromise = Promise.resolve(refreshToken())
        .then(token => {
          if (!token) {
            return token
          }

          const write = options.storage?.set(token)

          if (isPromiseLike(write)) {
            return Promise.resolve(write).then(() => token)
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

function applyAuthorization(
  config: RequestConfig,
  options: AuthPluginOptions
): MaybePromise<RequestConfig> {
  if (
    typeof options.token === 'string' &&
    options.token &&
    config.extensions?.auth === undefined
  ) {
    return setAuthorizationHeader(
      config,
      options.token,
      options.scheme
    )
  }

  const authorization = resolveAuthorization(config, options)

  if (isPromiseLike(authorization)) {
    return Promise.resolve(authorization).then(resolved => {
      return applyResolvedAuthorization(config, resolved)
    })
  }

  return applyResolvedAuthorization(config, authorization)
}

function applyResolvedAuthorization(
  config: RequestConfig,
  authorization: ResolvedAuthorization
): RequestConfig {
  if (!authorization.token) {
    return config
  }

  return setAuthorizationHeader(
    config,
    authorization.token,
    authorization.scheme
  )
}

function resolveAuthorization(
  config: RequestConfig,
  options: AuthPluginOptions,
  tokenOverride?: string
): MaybePromise<ResolvedAuthorization> {
  const requestAuth = resolveExtensionConfig(
    config,
    'auth'
  )

  const resolvedToken =
    tokenOverride ??
    (
      requestAuth?.token
        ? resolveToken(requestAuth.token)
        : resolvePluginToken(options)
    )
  const scheme = requestAuth?.scheme ?? options.scheme

  if (isPromiseLike(resolvedToken)) {
    return Promise.resolve(resolvedToken).then(token => ({
      token,
      scheme
    }))
  }

  return {
    token: resolvedToken,
    scheme
  }
}

interface ResolvedAuthorization {
  token: string
  scheme?: string
}

function resolvePluginToken(
  options: AuthPluginOptions
): MaybePromise<string> {
  const configuredToken = resolveToken(options.token)

  if (isPromiseLike(configuredToken)) {
    return Promise.resolve(configuredToken).then(token => {
      return token || resolveStoredToken(options.storage)
    })
  }

  if (configuredToken) {
    return configuredToken
  }

  return resolveStoredToken(options.storage)
}

function resolveStoredToken(
  storage: AuthTokenStorage | undefined
): MaybePromise<string> {
  const storedToken = storage?.get()

  if (isPromiseLike(storedToken)) {
    return Promise.resolve(storedToken).then(token => token ?? '')
  }

  return storedToken ?? ''
}

function resolveToken(
  token?: string | (() => MaybePromise<string>)
): MaybePromise<string> {
  if (!token) {
    return ''
  }

  return typeof token === 'function'
    ? token()
    : token
}

function setAuthorizationHeader(
  config: RequestConfig,
  token: string,
  scheme = 'Bearer'
): RequestConfig {
  const authorization = `${scheme} ${token}`

  if (config.headers === undefined) {
    return {
      ...config,
      headers: {
        authorization
      }
    }
  }

  const headers = new Headers(config.headers)

  headers.set('authorization', authorization)

  return {
    ...config,
    headers
  }
}

function defaultShouldRefresh(error: unknown): boolean {
  return (
    isRequestError(error) &&
    error.code === 'HTTP_ERROR' &&
    error.status === 401
  )
}
