/** Detect native streams across realms without locking or consuming them. */
export function isReadableStream<T = Uint8Array<ArrayBufferLike>>(
  value: unknown
): value is ReadableStream<T> {
  if (typeof ReadableStream === 'undefined') {
    return false
  }

  const getter = Object.getOwnPropertyDescriptor(
    ReadableStream.prototype,
    'locked'
  )?.get

  if (!getter) {
    return false
  }

  try {
    getter.call(value)
    return true
  } catch {
    return false
  }
}
