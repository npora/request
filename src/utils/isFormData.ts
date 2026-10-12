/** Detect native FormData values across JavaScript realms. */
export function isFormData(value: unknown): value is FormData {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof FormData === 'undefined'
  ) {
    return false
  }

  try {
    const prototype = Object.getPrototypeOf(value)

    if (prototype === Object.prototype || prototype === null) {
      return false
    }

    FormData.prototype.entries.call(value)
    return true
  } catch {
    return false
  }
}
