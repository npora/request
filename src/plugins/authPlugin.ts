import type { Client } from '../client'
import type { AuthOptions, RequestConfig } from '../types'
import type { Plugin } from './Plugin'

export function authPlugin(defaultOptions: AuthOptions = {}): Plugin {
  return {
    name: 'auth',

    install(client: Client) {
      client.interceptors.request.use(async config => {
        const auth = config.auth ?? defaultOptions

        if (!auth.token) {
          return config
        }

        const token =
          typeof auth.token === 'function' ? await auth.token() : auth.token

        if (!token) {
          return config
        }

        const scheme = auth.scheme ?? defaultOptions.scheme ?? 'Bearer'

        return {
          ...config,
          headers: mergeAuthorizationHeader(config, `${scheme} ${token}`)
        }
      })
    }
  }
}

function mergeAuthorizationHeader(
  config: RequestConfig,
  authorization: string
): HeadersInit {
  return {
    ...normalizeHeaders(config.headers),
    authorization
  }
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {}
  }

  if (headers instanceof Headers) {
    const result: Record<string, string> = {}

    headers.forEach((value, key) => {
      result[key] = value
    })

    return result
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return headers as Record<string, string>
}
