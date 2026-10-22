import { expect, it } from 'vitest'
import { toFormErrors } from '../src/schema-errors'

it('preserves nested paths, all messages and root-level errors', () => {
  const result = toFormErrors([
    { message: 'Required', path: ['users', { key: 0 }, 'name'] },
    { message: 'Too short', path: ['users', 0, 'name'] },
    { message: 'Invalid response' },
    { message: 'Invalid form', path: [] }
  ])
  expect(result.fieldErrors['users.0.name']).toEqual(['Required', 'Too short'])
  expect(result.formErrors).toEqual(['Invalid response', 'Invalid form'])
})

it('escapes ambiguous field names and treats symbol paths as form errors', () => {
  const result = toFormErrors([
    { message: 'nested', path: ['a', 'b'] },
    { message: 'literal', path: ['a.b'] },
    { message: 'slash', path: ['a\\b'] },
    { message: 'symbol', path: [Symbol('field')] },
    { message: 'empty', path: [''] }
  ])
  expect(result.fieldErrors['a.b']).toEqual(['nested'])
  expect(result.fieldErrors['a\\.b']).toEqual(['literal'])
  expect(result.fieldErrors['a\\\\b']).toEqual(['slash'])
  expect(result.fieldErrors['']).toEqual(['empty'])
  expect(result.formErrors).toEqual(['symbol'])
})

it('handles prototype keys without polluting or overwriting inherited properties', () => {
  const result = toFormErrors([
    { message: 'first', path: ['__proto__'] },
    { message: 'second', path: ['constructor'] }
  ])
  expect(Object.getPrototypeOf(result.fieldErrors)).toBeNull()
  expect(result.fieldErrors.__proto__).toEqual(['first'])
  expect(result.fieldErrors.constructor).toEqual(['second'])
  expect(toFormErrors([]).formErrors).toEqual([])
})
