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
      const abortController = vi.fn(() => {
        throw new Error('AbortController should not be created')
      })

      vi.stubGlobal('AbortController', abortController)

      const result = createTimeoutSignal(
        controller.signal,
        1000
      )

      expect(result.signal?.aborted).toBe(true)
      expect(result.signal?.reason).toBe('already-aborted')
      expect(result.signal).toBe(controller.signal)
      expect(abortController).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('should not retain a timer when listener registration fails', () => {
    vi.useFakeTimers()

    try {
      const removeEventListener = vi.fn()
      const signal = {
        aborted: false,
        addEventListener() {
          throw new Error('listener registration failed')
        },
        removeEventListener
      } as unknown as AbortSignal

      expect(() => createTimeoutSignal(signal, 1000)).toThrow(
        'listener registration failed'
      )
      expect(removeEventListener).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should not allocate a timer after synchronous external abort', () => {
    vi.useFakeTimers()

    try {
      const reason = new RequestError('synchronous abort', {
        code: 'ABORT_ERROR'
      })
      const signal = {
        aborted: false,
        reason,
        addEventListener(_type: string, listener: EventListener) {
          this.aborted = true
          listener(new Event('abort'))
        },
        removeEventListener() {}
      } as unknown as AbortSignal
      const result = createTimeoutSignal(signal, 1000)

      expect(result.signal?.aborted).toBe(true)
      expect(result.signal?.reason).toBe(reason)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should clear a timeout when listener removal throws', () => {
    vi.useFakeTimers()

    try {
      const signal = {
        aborted: false,
        addEventListener() {},
        removeEventListener() {
          throw new Error('listener cleanup failed')
        }
      } as unknown as AbortSignal
      const result = createTimeoutSignal(signal, 1000)

      expect(() => result.clear()).not.toThrow()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should remove the external listener when timer setup fails', () => {
    const removeEventListener = vi.fn()
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener
    } as unknown as AbortSignal

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw new Error('timer setup failed')
    })

    try {
      expect(() => createTimeoutSignal(signal, 1000)).toThrow(
        'timer setup failed'
      )
      expect(removeEventListener).toHaveBeenCalledTimes(1)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('should clear a handle returned by a synchronous timeout', () => {
    const removeEventListener = vi.fn()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener
    } as unknown as AbortSignal

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(callback => {
      callback()
      return 1 as unknown as ReturnType<typeof setTimeout>
    })

    try {
      const result = createTimeoutSignal(signal, 1000)

      expect(result.signal?.aborted).toBe(true)
      expect(result.signal?.reason).toMatchObject({
        code: 'TIMEOUT_ERROR'
      })
      expect(removeEventListener).toHaveBeenCalledTimes(1)
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
