import { describe, expect, it } from 'vitest'
import { createClient } from '../src'

describe('client', () => {
  it('should create client instance', () => {
    const client = createClient()

    expect(client).toBeDefined()
    expect(typeof client.request).toBe('function')
    expect(typeof client.get).toBe('function')
    expect(typeof client.post).toBe('function')
    expect(typeof client.put).toBe('function')
    expect(typeof client.patch).toBe('function')
    expect(typeof client.delete).toBe('function')
  })
})
