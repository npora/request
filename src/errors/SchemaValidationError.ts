import type {
  NporaResponse,
  StandardSchemaV1
} from '../types'
import { RequestError } from './RequestError'

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

    this.name = 'SchemaValidationError'
    this.issues = issues
    this.schemaVendor = schemaVendor
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
