/** Detect native Blob values across JavaScript realms. */
export function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' &&
    hasNativeGetter(Blob.prototype, 'size', value)
}

/** Detect native ArrayBuffer values across JavaScript realms. */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return typeof ArrayBuffer !== 'undefined' &&
    hasNativeGetter(ArrayBuffer.prototype, 'byteLength', value)
}

function hasNativeGetter(
  prototype: object,
  key: PropertyKey,
  value: unknown
): boolean {
  const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get

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
