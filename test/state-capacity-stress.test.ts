import { describe, expect, it } from 'vitest'
import {
  circuitBreakerPlugin,
  createClient,
  MemoryCacheStore,
  MockAdapter
} from '../src'

describe('bounded plugin state under high-cardinality input', () => {
  it('should retain only the configured number of memory cache entries', () => {
    const store = new MemoryCacheStore({
      maxEntries: 100
    })

    for (let index = 0; index < 10000; index += 1) {
      store.set(String(index), {
        data: index,
        expiresAt: Date.now() + 60000,
        status: 200,
        statusText: 'OK',
        headers: []
      })
    }

    let retained = 0

    for (let index = 0; index < 10000; index += 1) {
      if (store.get(String(index))) {
        retained += 1
      }
    }

    expect(retained).toBe(100)
    expect(store.get('9899')).toBeUndefined()
    expect(store.get('9900')?.data).toBe(9900)
    expect(store.get('9999')?.data).toBe(9999)
  })

  it('should evict old circuit state across many isolation keys', async () => {
    const adapter = new MockAdapter()
    const breaker = circuitBreakerPlugin({
      failureThreshold: 1,
      maxCircuits: 100
    })
    const request = createClient({ adapter }).use(breaker)

    adapter.onGet('/stress').reply(503)

    for (let index = 0; index < 2000; index += 1) {
      await expect(
        request.get('/stress', {
          extensions: {
            circuitBreaker: {
              key: String(index)
            }
          }
        })
      ).rejects.toMatchObject({
        code: 'HTTP_ERROR'
      })
    }

    expect(adapter.history).toHaveLength(2000)
    expect(breaker.getState('1899')).toBe('closed')
    expect(breaker.getState('1900')).toBe('open')
    expect(breaker.getState('1999')).toBe('open')
  })
})
