/**
 * Normalize string and cross-realm native URL inputs without trusting
 * URL-shaped application objects.
 */
export function normalizeURL(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    typeof URL === 'undefined'
  ) {
    return undefined
  }

  try {
    return URL.prototype.toString.call(value)
  } catch {
    return undefined
  }
}
