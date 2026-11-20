import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client/createClient'

describe('decoded Fetch response limits', () => {
  for (const encoding of ['gzip', 'br', 'GZIP', 'gzip, br']) {
    it.each(['data', 'response', 'stream'])(`${encoding}: %s ignores encoded length but enforces decoded bytes`, async mode => {
      const api = createClient({ fetch: async () => new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json', 'content-encoding': encoding, 'content-length': '100' }
      }) })
      const config = { maxResponseSize: 11, ...(mode === 'stream' ? { responseType: 'stream' as const } : {}) }
      if (mode === 'response') expect((await api.getResponse('/data', config)).data).toEqual({ ok: true })
      else if (mode === 'stream') expect(await new Response(await api.get<ReadableStream>('/data', config)).text()).toBe('{"ok":true}')
      else expect(await api.get('/data', config)).toEqual({ ok: true })

      if (mode === 'stream') {
        const body = await api.get<ReadableStream>('/data', { ...config, maxResponseSize: 10 })
        await expect(new Response(body).text()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
      } else {
        await expect(api.get('/data', { maxResponseSize: 10 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
      }
    })
  }

  it('keeps decoded HTTP error data within the soft error limit', async () => {
    const api = createClient({ fetch: async () => new Response('{"ok":true}', {
      status: 400, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '100' }
    }) })
    await expect(api.get('/error', { maxErrorResponseSize: 11 })).rejects.toMatchObject({
      code: 'HTTP_ERROR', response: { data: { ok: true } }
    })
    await expect(api.get('/error', { maxErrorResponseSize: 10 })).rejects.toMatchObject({
      code: 'HTTP_ERROR', response: { data: undefined }
    })
  })
})
