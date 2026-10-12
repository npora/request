import { describe, expect, it, vi } from 'vitest'
import { isArrayBuffer, isBlob } from '../src/utils/isBinaryBody'
import { isFormData } from '../src/utils/isFormData'
import { isReadableStream } from '../src/utils/isReadableStream'
import { isURLSearchParams } from '../src/utils/isURLSearchParams'

describe('native BodyInit guards', () => {
  it('should recognize native body values without consuming streams', () => {
    const stream = new ReadableStream<Uint8Array>()

    expect(isBlob(new Blob(['body']))).toBe(true)
    expect(isFormData(new FormData())).toBe(true)
    expect(isArrayBuffer(new ArrayBuffer(4))).toBe(true)
    expect(isReadableStream(stream)).toBe(true)
    expect(stream.locked).toBe(false)
  })

  it('should reject primitive bodies before consulting the native stream getter', () => {
    const locked = vi.spyOn(ReadableStream.prototype, 'locked', 'get')

    try {
      expect(isReadableStream('json body')).toBe(false)
      expect(isReadableStream(undefined)).toBe(false)
      expect(isReadableStream(null)).toBe(false)
      expect(locked).not.toHaveBeenCalled()
    } finally {
      locked.mockRestore()
    }
  })

  it('should skip native checks for ordinary form and query values', () => {
    const formEntries = vi.spyOn(FormData.prototype, 'entries')
    const queryEntries = vi.spyOn(URLSearchParams.prototype, 'entries')
    const blobSize = vi.spyOn(Blob.prototype, 'size', 'get')
    const bufferLength = vi.spyOn(ArrayBuffer.prototype, 'byteLength', 'get')

    try {
      expect(isFormData({ name: 'value' })).toBe(false)
      expect(isFormData('value')).toBe(false)
      expect(isURLSearchParams({ page: 1 })).toBe(false)
      expect(isURLSearchParams('page=1')).toBe(false)
      expect(isBlob('value')).toBe(false)
      expect(isArrayBuffer('value')).toBe(false)
      expect(formEntries).not.toHaveBeenCalled()
      expect(queryEntries).not.toHaveBeenCalled()
      expect(blobSize).not.toHaveBeenCalled()
      expect(bufferLength).not.toHaveBeenCalled()
    } finally {
      formEntries.mockRestore()
      queryEntries.mockRestore()
      blobSize.mockRestore()
      bufferLength.mockRestore()
    }
  })

  it('should recognize native values with an overridden string tag', () => {
    const formData = new FormData()
    const searchParams = new URLSearchParams('page=1')

    Object.defineProperty(formData, Symbol.toStringTag, { value: 'Custom' })
    Object.defineProperty(searchParams, Symbol.toStringTag, { value: 'Custom' })

    expect(isFormData(formData)).toBe(true)
    expect(isURLSearchParams(searchParams)).toBe(true)
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
