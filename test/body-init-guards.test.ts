import { describe, expect, it } from 'vitest'
import { isArrayBuffer, isBlob } from '../src/utils/isBinaryBody'
import { isFormData } from '../src/utils/isFormData'
import { isReadableStream } from '../src/utils/isReadableStream'

describe('native BodyInit guards', () => {
  it('should recognize native body values without consuming streams', () => {
    const stream = new ReadableStream<Uint8Array>()

    expect(isBlob(new Blob(['body']))).toBe(true)
    expect(isFormData(new FormData())).toBe(true)
    expect(isArrayBuffer(new ArrayBuffer(4))).toBe(true)
    expect(isReadableStream(stream)).toBe(true)
    expect(stream.locked).toBe(false)
  })

  it.each([
    ['Blob', isBlob],
    ['FormData', isFormData],
    ['ArrayBuffer', isArrayBuffer],
    ['ReadableStream', isReadableStream]
  ] as const)('should reject a spoofed %s brand', (brand, guard) => {
    const spoofed = {
      [Symbol.toStringTag]: brand,
      size: 1,
      byteLength: 1,
      entries() {},
      getReader() {}
    }

    expect(guard(spoofed)).toBe(false)
  })
})
