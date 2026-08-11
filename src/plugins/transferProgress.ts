export interface TransferProgressSnapshot {
  loaded: number
  total?: number
  progress?: number
  bytes: number
  rate?: number
  estimated?: number
}

const MIN_RATE_SAMPLE_MILLISECONDS = 250

/**
 * Track cumulative transfer values without scheduling timers or retaining
 * request resources after the caller releases the returned closure.
 */
export function createTransferProgressTracker(
  now: () => number = Date.now
): (
  loaded: number,
  total?: number
) => TransferProgressSnapshot {
  const startedAt = now()
  let previousLoaded = 0

  return (loaded, total) => {
    const bytes = Math.max(loaded - previousLoaded, 0)
    const elapsed = Math.max(now() - startedAt, 0) / 1000
    const rate = elapsed >= MIN_RATE_SAMPLE_MILLISECONDS / 1000 && loaded > 0
      ? loaded / elapsed
      : undefined
    const progress = total === undefined || total === 0
      ? undefined
      : Math.min(loaded / total, 1)
    const estimated = rate && total !== undefined
      ? Math.max(total - loaded, 0) / rate
      : undefined

    previousLoaded = loaded

    const snapshot: TransferProgressSnapshot = {
      loaded,
      total,
      bytes
    }

    if (progress !== undefined) {
      snapshot.progress = progress
    }

    if (rate !== undefined) {
      snapshot.rate = rate
    }

    if (estimated !== undefined) {
      snapshot.estimated = estimated
    }

    return snapshot
  }
}
