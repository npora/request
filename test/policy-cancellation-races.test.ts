import { expect, it } from 'vitest'
import { circuitBreakerPlugin, createClient, RequestError, retryPlugin } from '../src'

it.each(['retry', 'circuit'] as const)(
  '%s observes a started policy when cancellation wins during listener setup',
  async kind => {
    let rejectPolicy!: (error: Error) => void
    const policy = new Promise<boolean>((_resolve, reject) => { rejectPolicy = reject })
    let aborted = false
    const signal = {
      get aborted() { return aborted },
      reason: 'cancel during registration',
      addEventListener(_type: string, listener: EventListener) {
        aborted = true
        listener(new Event('abort'))
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    const client = createClient({
      adapter: {
        request(config) {
          throw new RequestError('Unavailable', { code: 'NETWORK_ERROR', config })
        }
      }
    }).use(kind === 'retry'
      ? retryPlugin({ retries: 1, shouldRetry: () => policy })
      : circuitBreakerPlugin({ shouldCountFailure: () => policy }))

    await expect(client.get('/pending-policy', { signal })).rejects.toMatchObject({
      code: kind === 'retry' ? 'ABORT_ERROR' : 'NETWORK_ERROR'
    })
    rejectPolicy(new Error('late policy rejection'))
    // Let Node report orphaned rejections before the test finishes.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
)
