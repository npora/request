import { describe, expect, it, vi } from 'vitest'
import { cachePlugin, createClient } from '../src'

describe('conditional cache revalidation without shared misses', () => {
  it.each(['plugin', 'request'] as const)('keeps ETag revalidation with dedupe disabled at %s level', async level => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('cached', {
        headers: { etag: '"v1"', 'cache-control': 'no-cache' }
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: { etag: '"v1"', 'cache-control': 'max-age=60' }
      }))
    const request = createClient({ fetch: fetchMock }).use(cachePlugin(
      level === 'plugin' ? { dedupe: false } : {}
    ))
    const config = {
      extensions: { cache: { enabled: true, ...(level === 'request' ? { dedupe: false } : {}) } }
    }

    await expect(request.get('/etag', config)).resolves.toBe('cached')
    await expect(request.get('/etag', config)).resolves.toBe('cached')
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBe('"v1"')
    await expect(request.get('/etag', config)).resolves.toBe('cached')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
