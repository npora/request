import { describe, expect, it } from 'vitest'
import { createClient } from '../src'

describe('client', () => {
  it('should create client', () => {
    const client = createClient()

    expect(client).toBeDefined()
    expect(typeof client.get).toBe('function')
    expect(typeof client.post).toBe('function')
  })
})