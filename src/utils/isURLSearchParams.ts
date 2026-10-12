/**
 * Detect native URLSearchParams values across JavaScript realms.
 *
 * `instanceof` rejects valid values created by another window or iframe.
 * Calling the native method performs the platform brand check instead.
 */
export function isURLSearchParams(
  value: unknown
): value is URLSearchParams {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof URLSearchParams === 'undefined'
  ) {
    return false
  }

  try {
    const prototype = Object.getPrototypeOf(value)

    if (prototype === Object.prototype || prototype === null) {
      return false
    }

    URLSearchParams.prototype.entries.call(value)
    return true
  } catch {
    return false
  }
}
