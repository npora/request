import type { RequestConfig } from '../types'

let cachedURL: string | undefined
let cachedBaseURL: string | undefined
let cachedOrigin: string | undefined

function parseOrigin(url: string, baseURL?: string): string | undefined {
  if (url === cachedURL && baseURL === cachedBaseURL)
    return cachedOrigin

  try {
    const origin = baseURL === undefined
      ? new URL(url).origin
      : new URL(url, baseURL).origin

    cachedURL = url
    cachedBaseURL = baseURL
    cachedOrigin = origin
    return origin
  } catch {
    return undefined
  }
}

/**
 * Resolve the isolation origin shared by stateful request plugins.
 */
export function resolveRequestOrigin(config: RequestConfig): string {
  const url = String(config.url)

  if (url.includes(':')) {
    const origin = parseOrigin(url)
    if (origin !== undefined)
      return origin
  }

  if (config.baseURL) {
    return parseOrigin(url, config.baseURL) ?? 'default'
  }

  return 'default'
}
