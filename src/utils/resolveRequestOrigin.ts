import type { RequestConfig } from '../types'

/**
 * Resolve the isolation origin shared by stateful request plugins.
 */
export function resolveRequestOrigin(config: RequestConfig): string {
  if (config.url.includes(':')) {
    try {
      return new URL(config.url).origin
    } catch {
      // A colon may belong to a relative path, query, or hash.
    }
  }

  if (config.baseURL) {
    try {
      return new URL(config.url, config.baseURL).origin
    } catch {
      // Relative bases do not provide a safe origin isolation key.
    }
  }

  return 'default'
}
