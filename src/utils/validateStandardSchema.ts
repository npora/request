import { SchemaValidationError } from '../errors'
import type {
  NporaResponse,
  StandardSchemaV1,
  StreamingSchemaLocation
} from '../types'

interface SchemaValidationMessages {
  failed: string
  invalid: string
  rejected: string
  location?: StreamingSchemaLocation
}

/** Validate one value through the shared Standard Schema result boundary. */
export async function validateStandardSchemaValue(
  schema: StandardSchemaV1,
  value: unknown,
  response: NporaResponse<unknown>,
  messages: SchemaValidationMessages
): Promise<unknown> {
  let result: Awaited<ReturnType<
    StandardSchemaV1['~standard']['validate']
  >>
  let schemaVendor = 'unknown'

  try {
    const standard = schema['~standard']

    schemaVendor = standard.vendor
    result = await standard.validate(value)
  } catch (error) {
    throw new SchemaValidationError(
      messages.failed,
      response,
      schemaVendor,
      [],
      error,
      messages.location
    )
  }

  if (typeof result !== 'object' || result === null) {
    throw invalidSchemaResult(
      messages,
      response,
      schemaVendor,
      'Expected a Standard Schema result'
    )
  }

  const issues = 'issues' in result ? result.issues : undefined

  if (issues !== undefined) {
    if (!Array.isArray(issues)) {
      throw invalidSchemaResult(
        messages,
        response,
        schemaVendor,
        'Expected Standard Schema issues to be an array'
      )
    }

    throw new SchemaValidationError(
      messages.rejected,
      response,
      schemaVendor,
      issues,
      undefined,
      messages.location
    )
  }

  if (!('value' in result)) {
    throw invalidSchemaResult(
      messages,
      response,
      schemaVendor,
      'Expected a Standard Schema value'
    )
  }

  return result.value
}

function invalidSchemaResult(
  messages: SchemaValidationMessages,
  response: NporaResponse<unknown>,
  schemaVendor: string,
  message: string
): SchemaValidationError {
  return new SchemaValidationError(
    messages.invalid,
    response,
    schemaVendor,
    [],
    new TypeError(message),
    messages.location
  )
}
