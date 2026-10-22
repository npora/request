import type { StandardSchemaV1 } from './types/standardSchema'

export interface FormErrors {
  /** Issues without a representable field path, including symbol keys. */
  formErrors: string[]
  /** All messages per field. Dots and backslashes in keys are escaped. */
  fieldErrors: Record<string, string[]>
}

/** Flatten Standard Schema issues without losing duplicate or form-level errors. */
export function toFormErrors(
  issues: ReadonlyArray<StandardSchemaV1.Issue>
): FormErrors {
  const result: FormErrors = {
    formErrors: [],
    fieldErrors: Object.create(null) as Record<string, string[]>
  }

  for (const issue of issues) {
    const keys = issue.path?.map(segment =>
      typeof segment === 'object' ? segment.key : segment
    )
    if (!keys?.length || keys.some(key => typeof key === 'symbol')) {
      result.formErrors.push(issue.message)
      continue
    }
    const path = keys.map(key => String(key).replace(/[\\.]/g, '\\$&')).join('.')
    ;(result.fieldErrors[path] ??= []).push(issue.message)
  }
  return result
}
