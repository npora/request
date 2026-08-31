/**
 * Detect native Headers values across JavaScript realms.
 *
 * `instanceof` rejects valid values created by another window or iframe.
 */
export function isHeaders(value: unknown): value is Headers {
  if (
    typeof Headers === 'undefined' ||
    typeof value !== 'object' ||
    value === null ||
    Object.prototype.toString.call(value) !== '[object Headers]'
  ) {
    return false
  }

  try {
    Headers.prototype.entries.call(value)
    return true
  } catch {
    return false
  }
}
