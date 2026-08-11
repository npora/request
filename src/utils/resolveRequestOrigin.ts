import type { RequestConfig } from '../types'

/**
 * Resolve the isolation origin shared by stateful request plugins.
 */
export function resolveRequestOrigin(config: RequestConfig): string {
  try {
    return new URL(config.url).origin
  } catch {
    // Resolve a relative request only when its base is absolute.
  }

  try {
    if (config.baseURL) {
      return new URL(config.url, config.baseURL).origin
    }
  } catch {
    // Relative bases do not provide a safe origin isolation key.
  }

  return 'default'
}
