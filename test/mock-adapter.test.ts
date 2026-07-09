import { describe, expect, it } from 'vitest'
import { MockAdapter } from '../src'

describe('MockAdapter', () => {
  it('should return mock response from constructor handlers', async () => {
    const adapter = new MockAdapter({
      handlers: {
        '/user': () => ({
          name: 'Npora'
        })
      }
    })

    const response = await adapter.request<{ name: string }>({
      url: '/user'
    })

    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      name: 'Npora'
    })
  })

  it('should return mock response from on method', async () => {
    const adapter = new MockAdapter()

    adapter.on('/todo', () => ({
      id: 1,
      title: 'Learn Npora'
    }))

    const response = await adapter.request<{ id: number; title: string }>({
      url: '/todo'
    })

    expect(response.data).toEqual({
      id: 1,
      title: 'Learn Npora'
    })
  })

  it('should throw when mock handler is missing', async () => {
    const adapter = new MockAdapter()

    await expect(
      adapter.request({
        url: '/missing'
      })
    ).rejects.toThrow('No mock handler found for /missing')
  })
})
