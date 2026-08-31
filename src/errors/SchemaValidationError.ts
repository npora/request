import type {
  NporaResponse,
  StandardSchemaV1
} from '../types'
import { RequestError } from './RequestError'

const SCHEMA_VALIDATION_ERROR_BRAND = Symbol.for(
  '@npora/request/SchemaValidationError'
)

/**
 * Response failure reported by a Standard Schema compatible validator.
 */
export class SchemaValidationError<T = unknown> extends RequestError<T> {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

  readonly schemaVendor: string

  constructor(
    message: string,
    response: NporaResponse<T>,
    schemaVendor: string,
    issues: ReadonlyArray<StandardSchemaV1.Issue> = [],
    cause?: unknown
  ) {
    super(message, {
      code: 'SCHEMA_ERROR',
      response,
      cause
    })

    Object.defineProperty(this, SCHEMA_VALIDATION_ERROR_BRAND, {
      value: true
    })
    this.name = 'SchemaValidationError'
    this.issues = issues
    this.schemaVendor = schemaVendor
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Identify schema validation errors across realms and package instances.
 */
export function isSchemaValidationError<T = unknown>(
  value: unknown
): value is SchemaValidationError<T> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false
  }

  try {
    return Reflect.get(
      value,
      SCHEMA_VALIDATION_ERROR_BRAND
    ) === true
  } catch {
    return false
  }
}
