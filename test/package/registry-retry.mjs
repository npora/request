const DEFAULT_RETRY_DELAYS = [
  2_000,
  4_000,
  8_000,
  16_000,
  30_000
]

/**
 * Retry the short window where npm has accepted a publish but its package
 * metadata is not yet visible to every registry reader.
 */
export async function retryRegistryInstall(
  install,
  options = {}
) {
  const delays = options.delays ?? DEFAULT_RETRY_DELAYS
  const wait = options.wait ?? waitForDelay

  for (let attempt = 0; ; attempt += 1) {
    const result = install()

    if (
      result.status === 0 ||
      !isRegistryPropagationFailure(result) ||
      attempt >= delays.length
    ) {
      return result
    }

    const delay = delays[attempt]

    options.onRetry?.({
      attempt: attempt + 2,
      delay,
      maximumAttempts: delays.length + 1
    })
    await wait(delay)
  }
}

export function isRegistryPropagationFailure(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  return /\b(?:ETARGET|E404)\b/.test(output)
}

function waitForDelay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
