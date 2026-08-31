/** Detect native FormData values across JavaScript realms. */
export function isFormData(value: unknown): value is FormData {
  if (typeof FormData === 'undefined') {
    return false
  }

  try {
    FormData.prototype.entries.call(value)
    return true
  } catch {
    return false
  }
}
