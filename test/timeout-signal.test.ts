import { describe, expect, it, vi } from 'vitest'
import { RequestError } from '../src'
import { createTimeoutSignal } from '../src/utils/createTimeoutSignal'

describe('createTimeoutSignal', () => {
  it('should remove the external abort listener when cleared', () => {
    const controller = new AbortController()
    const addSpy = vi.spyOn(
      controller.signal,
      'addEventListener'
    )
    const removeSpy = vi.spyOn(
      controller.signal,
      'removeEventListener'
    )
    const result = createTimeoutSignal(
      controller.signal,
      1000
    )
    const listener = addSpy.mock.calls[0]?.[1]

    result.clear()
    result.clear()

    expect(listener).toBeTypeOf('function')
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledWith('abort', listener)
  })

  it('should clear resources when the external signal aborts', () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      const removeSpy = vi.spyOn(
        controller.signal,
        'removeEventListener'
      )
      const result = createTimeoutSignal(
        controller.signal,
        1000
      )

      controller.abort(
        new RequestError('User aborted', {
          code: 'ABORT_ERROR'
        })
      )

      expect(result.signal?.aborted).toBe(true)
      expect(result.signal?.reason).toMatchObject({
        code: 'ABORT_ERROR'
      })
      expect(removeSpy).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should remove the external listener when timeout expires', () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      const removeSpy = vi.spyOn(
        controller.signal,
        'removeEventListener'
      )
      const result = createTimeoutSignal(
        controller.signal,
        10
      )

      vi.advanceTimersByTime(10)

      expect(result.signal?.aborted).toBe(true)
      expect(result.signal?.reason).toMatchObject({
        code: 'TIMEOUT_ERROR'
      })
      expect(removeSpy).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should not retain a timer for an already aborted signal', () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()

      controller.abort('already-aborted')

      const result = createTimeoutSignal(
        controller.signal,
        1000
      )

      expect(result.signal?.aborted).toBe(true)
      expect(result.signal?.reason).toBe('already-aborted')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
