/** Async generators do not enter their finally block when closed before next(). */
export function withEarlyIteratorCleanup<T>(
  create: (start: () => void) => AsyncGenerator<T>,
  cleanup: () => unknown
): AsyncGenerator<T> {
  let started = false
  let pendingCleanup: Promise<unknown> | undefined
  // Mark entry inside the generator, keeping native next() dispatch intact.
  const iterator = create(() => { started = true })

  for (const method of ['return', 'throw'] as const) {
    const close = iterator[method]
    iterator[method] = value => {
      const early = !started
      started = true
      const result = close.call(iterator, value)
      if (!early && !pendingCleanup) return result
      // Observe both outcomes immediately and preserve the iterator result.
      if (early) pendingCleanup = Promise.resolve().then(cleanup).catch(() => {})
      return Promise.allSettled([result, pendingCleanup]).then(([outcome]) => {
        if (outcome.status === 'rejected') throw outcome.reason
        return outcome.value
      })
    }
  }
  return iterator
}
