/** Use the same owned iterator for consumption and cancellation. */
export function singleIterator<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  let iterator: AsyncIterator<T> | undefined
  return { [Symbol.asyncIterator]() { return iterator ??= source[Symbol.asyncIterator]() } }
}

/** Close early generators and interrupt work that would otherwise block return/throw. */
export function withEarlyIteratorCleanup<T>(
  create: (start: () => void) => AsyncGenerator<T>,
  cleanup: () => unknown,
  interrupt?: () => unknown
): AsyncGenerator<T> {
  let started = false
  let pendingCleanup: Promise<unknown> | undefined
  let interrupted = false
  // Mark entry inside the generator, keeping native next() dispatch intact.
  const iterator = create(() => { started = true })

  for (const method of ['return', 'throw'] as const) {
    const close = iterator[method]
    iterator[method] = value => {
      const early = !started
      started = true
      if (interrupt && !interrupted) {
        interrupted = true
        try { void Promise.resolve(interrupt()).catch(() => {}) } catch { /* best effort */ }
      }
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
