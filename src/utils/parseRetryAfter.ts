/**
 * Parse the standard Retry-After response header into a non-negative delay.
 */
export function parseRetryAfter(
  headers: Headers | undefined,
  now = Date.now()
): number | undefined {
  const value = headers?.get('retry-after')?.trim()

  if (!value) {
    return undefined
  }

  if (/^\d+$/.test(value)) {
    const seconds = Number(value)

    return Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : undefined
  }

  const timestamp = Date.parse(value)

  return Number.isNaN(timestamp)
    ? undefined
    : Math.max(0, timestamp - now)
}
